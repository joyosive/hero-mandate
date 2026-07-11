//! Hero Mandate: Chain of Mandate protocol.
//!
//! A mandate is escrowed authority for an autonomous agent: capacity in wei,
//! an expiry, a merkle-committed instrument scope, and a model fingerprint.
//! Mandates form a tree. Delegation carves capacity out of the parent, so a
//! child can never exceed its parent by construction. Every execution proves
//! its instrument against the scope root of the executing node and every
//! ancestor, revealing only the single leaf in use. Failed attempts by the
//! mandate's own agent are refused and recorded at the exact node where the
//! breach happened (record-and-refuse), never silently reverted.
//!
//! Receipts are a per-mandate hash chain folding in the model fingerprint,
//! so the decision maker is bound to every action. Tamper evident by
//! recomputation from events.
//!
//! This contract never touches order execution, custody, or routing. The
//! escrow is authority capacity, not payment rails.

#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

use alloc::{vec, vec::Vec};
use stylus_sdk::{
    alloy_primitives::{Address, B256, U256},
    alloy_sol_types::sol,
    call::transfer::transfer_eth,
    crypto,
    prelude::*,
};

/// Maximum tree depth. Bounds the ancestor proof walk in execute.
const MAX_DEPTH: u64 = 8;

/// Breach codes recorded by execute.
const BREACH_EXPIRED: u8 = 1;
const BREACH_CAPACITY: u8 = 2;
const BREACH_SCOPE: u8 = 3;

sol! {
    event MandateCreated(uint256 indexed id, address indexed agent, uint256 capacity, uint64 expiry, bytes32 scopeRoot, bytes32 modelHash);
    event Delegated(uint256 indexed parentId, uint256 indexed childId, address indexed agent, uint256 amount, uint64 expiry, bytes32 scopeRoot, bytes32 modelHash);
    event Executed(uint256 indexed id, bytes32 indexed instrument, uint256 amount, bytes32 newHead, uint64 timestamp);
    event Breach(uint256 indexed id, uint8 code, bytes32 instrument, uint256 amount);
    event Reclaimed(uint256 indexed id, uint256 amount, address to);
}

sol_storage! {
    #[entrypoint]
    pub struct HeroMandate {
        /// Number of mandates ever created. Ids run 1..=count. Zero is null.
        uint256 count;
        mapping(uint256 => Node) nodes;
    }

    pub struct Node {
        uint256 parent;
        address agent;
        /// Original grant, kept for observers.
        uint256 capacity;
        /// Unspent, undelegated authority. Spend and delegation both draw it down.
        uint256 remaining;
        uint64 expiry;
        uint64 depth;
        bytes32 scope_root;
        bytes32 model_hash;
        bytes32 receipt_head;
        uint64 breaches;
        /// Root funder, propagated down the tree. Reclaims expired capacity.
        address funder;
    }
}

#[public]
impl HeroMandate {
    /// Create a root mandate. Escrowed capacity is msg.value.
    #[payable]
    pub fn create_mandate(
        &mut self,
        agent: Address,
        expiry: u64,
        scope_root: B256,
        model_hash: B256,
    ) -> Result<U256, Vec<u8>> {
        let value = self.vm().msg_value();
        if value.is_zero() {
            return Err(b"zero capacity".to_vec());
        }
        if expiry <= self.vm().block_timestamp() {
            return Err(b"expiry in the past".to_vec());
        }
        if scope_root.is_zero() {
            return Err(b"empty scope".to_vec());
        }
        let funder = self.vm().msg_sender();
        let id = self.count.get() + U256::from(1);
        self.count.set(id);

        let mut node = self.nodes.setter(id);
        node.parent.set(U256::ZERO);
        node.agent.set(agent);
        node.capacity.set(value);
        node.remaining.set(value);
        node.expiry.set(stylus_sdk::alloy_primitives::Uint::from(expiry));
        node.depth.set(stylus_sdk::alloy_primitives::Uint::from(0u64));
        node.scope_root.set(scope_root);
        node.model_hash.set(model_hash);
        node.receipt_head.set(B256::ZERO);
        node.funder.set(funder);

        self.vm().log(MandateCreated {
            id,
            agent,
            capacity: value,
            expiry,
            scopeRoot: scope_root,
            modelHash: model_hash,
        });
        Ok(id)
    }

    /// Delegate a narrower mandate to a sub-agent. Capacity physically moves
    /// from the parent's remaining balance, so narrowing cannot be faked.
    pub fn delegate(
        &mut self,
        parent_id: U256,
        agent: Address,
        amount: U256,
        expiry: u64,
        scope_root: B256,
        model_hash: B256,
    ) -> Result<U256, Vec<u8>> {
        self.require_exists(parent_id)?;
        let now = self.vm().block_timestamp();
        let sender = self.vm().msg_sender();

        let parent = self.nodes.getter(parent_id);
        if sender != parent.agent.get() {
            return Err(b"not mandate agent".to_vec());
        }
        let parent_expiry: u64 = parent.expiry.get().to::<u64>();
        if now >= parent_expiry {
            return Err(b"parent expired".to_vec());
        }
        if expiry <= now || expiry > parent_expiry {
            return Err(b"expiry outside parent window".to_vec());
        }
        if amount.is_zero() || amount > parent.remaining.get() {
            return Err(b"amount exceeds parent remaining".to_vec());
        }
        if scope_root.is_zero() {
            return Err(b"empty scope".to_vec());
        }
        let parent_depth: u64 = parent.depth.get().to::<u64>();
        if parent_depth + 1 > MAX_DEPTH {
            return Err(b"max depth".to_vec());
        }
        let funder = parent.funder.get();
        drop(parent);

        let mut parent_mut = self.nodes.setter(parent_id);
        let new_remaining = parent_mut.remaining.get() - amount;
        parent_mut.remaining.set(new_remaining);
        drop(parent_mut);

        let id = self.count.get() + U256::from(1);
        self.count.set(id);

        let mut child = self.nodes.setter(id);
        child.parent.set(parent_id);
        child.agent.set(agent);
        child.capacity.set(amount);
        child.remaining.set(amount);
        child.expiry.set(stylus_sdk::alloy_primitives::Uint::from(expiry));
        child.depth.set(stylus_sdk::alloy_primitives::Uint::from(parent_depth + 1));
        child.scope_root.set(scope_root);
        child.model_hash.set(model_hash);
        child.receipt_head.set(B256::ZERO);
        child.funder.set(funder);

        self.vm().log(Delegated {
            parentId: parent_id,
            childId: id,
            agent,
            amount,
            expiry,
            scopeRoot: scope_root,
            modelHash: model_hash,
        });
        Ok(id)
    }

    /// Execute an action under a mandate. Record-and-refuse semantics: an
    /// in-authority caller attempting an out-of-authority action gets the
    /// action refused AND a Breach recorded at this node. Only the mandate's
    /// own agent may call, so strangers cannot spam breaches.
    ///
    /// proofs[0] proves the instrument against this node's scope root,
    /// proofs[1] against the parent's, and so on up to the root.
    pub fn execute(
        &mut self,
        id: U256,
        instrument: B256,
        amount: U256,
        proofs: Vec<Vec<B256>>,
    ) -> Result<bool, Vec<u8>> {
        self.require_exists(id)?;
        let sender = self.vm().msg_sender();
        let now = self.vm().block_timestamp();

        let node = self.nodes.getter(id);
        if sender != node.agent.get() {
            return Err(b"not mandate agent".to_vec());
        }
        let expiry: u64 = node.expiry.get().to::<u64>();
        let remaining = node.remaining.get();
        let depth: u64 = node.depth.get().to::<u64>();
        let model_hash = node.model_hash.get();
        let head = node.receipt_head.get();
        drop(node);

        if now >= expiry {
            return Ok(self.breach(id, BREACH_EXPIRED, instrument, amount));
        }
        if amount.is_zero() || amount > remaining {
            return Ok(self.breach(id, BREACH_CAPACITY, instrument, amount));
        }
        if !self.scope_allowed(id, depth, instrument, &proofs) {
            return Ok(self.breach(id, BREACH_SCOPE, instrument, amount));
        }

        let mut node = self.nodes.setter(id);
        node.remaining.set(remaining - amount);
        let new_head = receipt_hash(head, instrument, amount, model_hash, now);
        node.receipt_head.set(new_head);
        drop(node);

        self.vm().log(Executed {
            id,
            instrument,
            amount,
            newHead: new_head,
            timestamp: now,
        });
        Ok(true)
    }

    /// After expiry, remaining capacity returns to the root funder.
    pub fn reclaim(&mut self, id: U256) -> Result<(), Vec<u8>> {
        self.require_exists(id)?;
        let node = self.nodes.getter(id);
        let funder = node.funder.get();
        let expiry: u64 = node.expiry.get().to::<u64>();
        let amount = node.remaining.get();
        drop(node);

        if self.vm().msg_sender() != funder {
            return Err(b"not funder".to_vec());
        }
        if self.vm().block_timestamp() < expiry {
            return Err(b"not expired".to_vec());
        }
        if amount.is_zero() {
            return Err(b"nothing to reclaim".to_vec());
        }
        let mut node = self.nodes.setter(id);
        node.remaining.set(U256::ZERO);
        drop(node);

        transfer_eth(self.vm(), funder, amount)?;
        self.vm().log(Reclaimed {
            id,
            amount,
            to: funder,
        });
        Ok(())
    }

    /// Full node view, one call.
    pub fn get_mandate(
        &self,
        id: U256,
    ) -> Result<(U256, Address, U256, u64, B256, B256, B256, u64), Vec<u8>> {
        self.require_exists(id)?;
        let n = self.nodes.getter(id);
        Ok((
            n.parent.get(),
            n.agent.get(),
            n.remaining.get(),
            n.expiry.get().to::<u64>(),
            n.scope_root.get(),
            n.model_hash.get(),
            n.receipt_head.get(),
            n.breaches.get().to::<u64>(),
        ))
    }

    pub fn mandate_count(&self) -> U256 {
        self.count.get()
    }

    /// Original grant of a node, for observers drawing capacity bars.
    pub fn capacity_of(&self, id: U256) -> Result<U256, Vec<u8>> {
        self.require_exists(id)?;
        Ok(self.nodes.getter(id).capacity.get())
    }
}

impl HeroMandate {
    fn require_exists(&self, id: U256) -> Result<(), Vec<u8>> {
        if id.is_zero() || id > self.count.get() {
            return Err(b"unknown mandate".to_vec());
        }
        Ok(())
    }

    /// Record a breach at this node and refuse the action.
    fn breach(&mut self, id: U256, code: u8, instrument: B256, amount: U256) -> bool {
        let mut node = self.nodes.setter(id);
        let breaches: u64 = node.breaches.get().to::<u64>();
        node.breaches
            .set(stylus_sdk::alloy_primitives::Uint::from(breaches + 1));
        drop(node);
        self.vm().log(Breach {
            id,
            code,
            instrument,
            amount,
        });
        false
    }

    /// The instrument must prove into the scope root of this node and every
    /// ancestor. Each level reveals only the leaf in use, never the set.
    fn scope_allowed(&self, id: U256, depth: u64, instrument: B256, proofs: &[Vec<B256>]) -> bool {
        if proofs.len() as u64 != depth + 1 {
            return false;
        }
        let leaf = crypto::keccak(instrument.as_slice());
        let mut walk = id;
        for proof in proofs.iter() {
            let node = self.nodes.getter(walk);
            let root = node.scope_root.get();
            let parent = node.parent.get();
            drop(node);
            if !merkle_verify(leaf, proof, root) {
                return false;
            }
            walk = parent;
        }
        true
    }
}

/// Sorted-pair merkle verification. Leaf and nodes hash with keccak256.
fn merkle_verify(leaf: B256, proof: &[B256], root: B256) -> bool {
    let mut computed = leaf;
    for sibling in proof {
        let mut buf = [0u8; 64];
        if computed.as_slice() <= sibling.as_slice() {
            buf[..32].copy_from_slice(computed.as_slice());
            buf[32..].copy_from_slice(sibling.as_slice());
        } else {
            buf[..32].copy_from_slice(sibling.as_slice());
            buf[32..].copy_from_slice(computed.as_slice());
        }
        computed = crypto::keccak(buf);
    }
    computed == root
}

/// Receipt chain step. Packed exactly as
/// keccak256(prevHead . instrument . amount as 32 bytes BE . modelHash . timestamp as 8 bytes BE)
/// so anyone can recompute the chain from Executed events.
fn receipt_hash(prev: B256, instrument: B256, amount: U256, model_hash: B256, ts: u64) -> B256 {
    let mut buf = [0u8; 136];
    buf[..32].copy_from_slice(prev.as_slice());
    buf[32..64].copy_from_slice(instrument.as_slice());
    buf[64..96].copy_from_slice(&amount.to_be_bytes::<32>());
    buf[96..128].copy_from_slice(model_hash.as_slice());
    buf[128..136].copy_from_slice(&ts.to_be_bytes());
    crypto::keccak(buf)
}

#[cfg(test)]
mod test {
    use super::*;
    use stylus_sdk::testing::*;

    const DAY: u64 = 86_400;

    fn b32(tag: &str) -> B256 {
        crypto::keccak(tag.as_bytes())
    }

    /// Build a sorted-pair merkle tree over instrument ids, return
    /// (root, proof for target). Mirrors the off-chain tooling.
    fn tree(instruments: &[B256], target: B256) -> (B256, Vec<B256>) {
        let mut level: Vec<B256> = instruments
            .iter()
            .map(|i| crypto::keccak(i.as_slice()))
            .collect();
        level.sort();
        let mut index = level
            .iter()
            .position(|l| *l == crypto::keccak(target.as_slice()))
            .unwrap_or(usize::MAX);
        let mut proof = vec![];
        while level.len() > 1 {
            let mut next = vec![];
            let mut i = 0;
            while i < level.len() {
                if i + 1 < level.len() {
                    let (a, b) = (level[i], level[i + 1]);
                    let mut buf = [0u8; 64];
                    if a.as_slice() <= b.as_slice() {
                        buf[..32].copy_from_slice(a.as_slice());
                        buf[32..].copy_from_slice(b.as_slice());
                    } else {
                        buf[..32].copy_from_slice(b.as_slice());
                        buf[32..].copy_from_slice(a.as_slice());
                    }
                    if index == i || index == i + 1 {
                        proof.push(if index == i { b } else { a });
                        index = next.len();
                    }
                    next.push(crypto::keccak(buf));
                    i += 2;
                } else {
                    if index == i {
                        index = next.len();
                    }
                    next.push(level[i]);
                    i += 1;
                }
            }
            level = next;
        }
        (level[0], proof)
    }

    fn instruments() -> (B256, B256, B256) {
        (b32("ETH-USD"), b32("ARB-USD"), b32("BTC-USD"))
    }

    #[test]
    fn create_and_read() {
        let vm = TestVM::default();
        let mut c = HeroMandate::from(&vm);
        let (eth, arb, btc) = instruments();
        let (root, _) = tree(&[eth, arb, btc], eth);

        vm.set_value(U256::from(500));
        let agent = Address::from([1u8; 20]);
        let id = c
            .create_mandate(agent, vm.block_timestamp() + DAY, root, b32("model-v1"))
            .unwrap();
        assert_eq!(id, U256::from(1));
        let (parent, got_agent, remaining, _, scope, _, head, breaches) =
            c.get_mandate(id).unwrap();
        assert_eq!(parent, U256::ZERO);
        assert_eq!(got_agent, agent);
        assert_eq!(remaining, U256::from(500));
        assert_eq!(scope, root);
        assert_eq!(head, B256::ZERO);
        assert_eq!(breaches, 0);
    }

    #[test]
    fn delegation_carves_capacity() {
        let vm = TestVM::default();
        let mut c = HeroMandate::from(&vm);
        let (eth, arb, btc) = instruments();
        let (root, _) = tree(&[eth, arb, btc], eth);
        let (child_root, _) = tree(&[eth, arb], eth);

        let orch = Address::from([1u8; 20]);
        let sub = Address::from([2u8; 20]);
        vm.set_value(U256::from(500));
        let root_id = c
            .create_mandate(orch, vm.block_timestamp() + DAY, root, b32("m1"))
            .unwrap();

        vm.set_value(U256::ZERO);
        vm.set_sender(orch);
        let child_id = c
            .delegate(
                root_id,
                sub,
                U256::from(150),
                vm.block_timestamp() + DAY / 2,
                child_root,
                b32("m2"),
            )
            .unwrap();

        let (_, _, parent_remaining, ..) = c.get_mandate(root_id).unwrap();
        let (got_parent, _, child_remaining, ..) = c.get_mandate(child_id).unwrap();
        assert_eq!(parent_remaining, U256::from(350));
        assert_eq!(child_remaining, U256::from(150));
        assert_eq!(got_parent, root_id);

        // over-delegation is impossible by construction
        assert!(c
            .delegate(
                root_id,
                sub,
                U256::from(351),
                vm.block_timestamp() + DAY / 2,
                child_root,
                b32("m3"),
            )
            .is_err());
        // expiry cannot exceed the parent window
        assert!(c
            .delegate(
                root_id,
                sub,
                U256::from(10),
                vm.block_timestamp() + 2 * DAY,
                child_root,
                b32("m4"),
            )
            .is_err());
    }

    #[test]
    fn execute_and_receipt_chain() {
        let vm = TestVM::default();
        let mut c = HeroMandate::from(&vm);
        let (eth, arb, btc) = instruments();
        let (root, root_proof_eth) = tree(&[eth, arb, btc], eth);
        let (child_root, child_proof_eth) = tree(&[eth, arb], eth);

        let orch = Address::from([1u8; 20]);
        let sub = Address::from([2u8; 20]);
        vm.set_value(U256::from(500));
        let root_id = c
            .create_mandate(orch, vm.block_timestamp() + DAY, root, b32("m1"))
            .unwrap();
        vm.set_value(U256::ZERO);
        vm.set_sender(orch);
        let child_id = c
            .delegate(
                root_id,
                sub,
                U256::from(150),
                vm.block_timestamp() + DAY / 2,
                child_root,
                b32("m2"),
            )
            .unwrap();

        vm.set_sender(sub);
        let ok = c
            .execute(
                child_id,
                eth,
                U256::from(40),
                vec![child_proof_eth.clone(), root_proof_eth.clone()],
            )
            .unwrap();
        assert!(ok);
        let (_, _, remaining, _, _, model, head, breaches) = c.get_mandate(child_id).unwrap();
        assert_eq!(remaining, U256::from(110));
        assert_eq!(breaches, 0);
        let expected = receipt_hash(
            B256::ZERO,
            eth,
            U256::from(40),
            model,
            vm.block_timestamp(),
        );
        assert_eq!(head, expected);
    }

    #[test]
    fn breach_is_recorded_and_refused_at_the_right_node() {
        let vm = TestVM::default();
        let mut c = HeroMandate::from(&vm);
        let (eth, arb, btc) = instruments();
        let (root, _) = tree(&[eth, arb, btc], eth);
        let (child_root, child_proof_eth) = tree(&[eth, arb], eth);
        let (_, root_proof_eth) = tree(&[eth, arb, btc], eth);
        let (_, child_proof_btc) = tree(&[eth, arb], btc);
        let (_, root_proof_btc) = tree(&[eth, arb, btc], btc);

        let orch = Address::from([1u8; 20]);
        let sub = Address::from([2u8; 20]);
        vm.set_value(U256::from(500));
        let root_id = c
            .create_mandate(orch, vm.block_timestamp() + DAY, root, b32("m1"))
            .unwrap();
        vm.set_value(U256::ZERO);
        vm.set_sender(orch);
        let child_id = c
            .delegate(
                root_id,
                sub,
                U256::from(150),
                vm.block_timestamp() + DAY / 2,
                child_root,
                b32("m2"),
            )
            .unwrap();

        vm.set_sender(sub);
        // BTC is in the ROOT scope but not in the child scope: refused, breach
        // pinned to the child node, no state change on the parent.
        let ok = c
            .execute(
                child_id,
                btc,
                U256::from(10),
                vec![child_proof_btc, root_proof_btc],
            )
            .unwrap();
        assert!(!ok);
        // over capacity: refused, second breach
        let ok = c
            .execute(
                child_id,
                eth,
                U256::from(151),
                vec![child_proof_eth.clone(), root_proof_eth.clone()],
            )
            .unwrap();
        assert!(!ok);

        let (_, _, child_remaining, _, _, _, child_head, child_breaches) =
            c.get_mandate(child_id).unwrap();
        assert_eq!(child_breaches, 2);
        assert_eq!(child_remaining, U256::from(150));
        assert_eq!(child_head, B256::ZERO);
        let (_, _, _, _, _, _, _, root_breaches) = c.get_mandate(root_id).unwrap();
        assert_eq!(root_breaches, 0);

        // a stranger cannot spam breaches: wrong caller reverts outright
        vm.set_sender(Address::from([9u8; 20]));
        assert!(c
            .execute(child_id, eth, U256::from(1), vec![vec![], vec![]])
            .is_err());
    }

    #[test]
    fn reclaim_after_expiry() {
        let vm = TestVM::default();
        let mut c = HeroMandate::from(&vm);
        let (eth, arb, btc) = instruments();
        let (root, _) = tree(&[eth, arb, btc], eth);

        let funder = vm.msg_sender();
        let orch = Address::from([1u8; 20]);
        vm.set_value(U256::from(500));
        let id = c
            .create_mandate(orch, vm.block_timestamp() + DAY, root, b32("m1"))
            .unwrap();
        vm.set_value(U256::ZERO);

        // not expired yet
        assert!(c.reclaim(id).is_err());
        vm.set_block_timestamp(vm.block_timestamp() + DAY + 1);
        // wrong caller
        vm.set_sender(orch);
        assert!(c.reclaim(id).is_err());
        vm.set_sender(funder);
        c.reclaim(id).unwrap();
        let (_, _, remaining, ..) = c.get_mandate(id).unwrap();
        assert_eq!(remaining, U256::ZERO);
    }
}
