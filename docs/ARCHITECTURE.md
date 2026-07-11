# Hero Mandate: Chain of Mandate protocol

Delegated authority for autonomous trading agents that provably narrows at
every level of delegation, enforced by construction, on Arbitrum Stylus.

## Problem

Agentic trading is going multi-agent: an orchestrator hires specialist
sub-agents (momentum, hedging, yield). Today there is no way to delegate
authority downward such that:

1. a sub-agent provably cannot exceed what its parent granted,
2. the strategy behind the authority stays private,
3. a breach is attributable to the exact level of the chain where it happened,
4. the decision maker (the model) is bound to every action it takes.

Session-key and permission standards (ERC-7715 and friends) grant plaintext
authority upfront and verify nothing after the fact. Audit tools observe
agents from outside. Neither makes authority itself an enforceable object.

## The primitive

A mandate is an on-chain node: escrowed capacity + committed scope + expiry +
model fingerprint. Mandates form a tree.

Narrowing is enforced by construction, not by policy:

- Capacity: a child mandate is carved out of its parent's escrowed balance.
  Delegating 150 out of a 500 mandate leaves the parent 350. A child cannot
  exceed its parent because the capacity physically moves. No comparison
  logic to get wrong, nothing to audit after the fact.
- Expiry: child expiry must be <= parent expiry. Checked at delegation.
- Scope: the set of allowed instruments is committed as a merkle root, so the
  strategy universe is never published. Every execution reveals exactly one
  leaf (the instrument being traded) and proves it against the roots of the
  executing mandate AND every ancestor up the chain. A child can only use
  scope its whole lineage allows, without any ancestor revealing its set.
- Model binding: each mandate commits a hash of the model/policy version
  driving the agent. Every receipt folds that fingerprint into the hash
  chain: decision bound to deed.

Breach handling is record-and-refuse: an in-authority agent attempting an
out-of-authority action does not revert silently. The contract refuses the
action AND records a Breach event pinned to that exact mandate node, so the
failure is attributable at the right level of the chain.

Receipts are a per-mandate hash chain: head = keccak(prevHead, instrument,
amount, modelHash, timestamp). One altered byte breaks the
chain. Anyone can recompute from events. Tamper evident, never tamper proof.

## What Hero Mandate does NOT do

No order execution, no custody of trading assets, no routing, no touching
tokenized securities. The escrow is authority capacity, not payment rails.
Hero proves agent behaviour; venues execute trades. That line keeps the
protocol out of the securities blast radius and is exactly why it is useful
to regulated platforms.

## Contract surface (Stylus, Rust)

- createMandate(agent, expiry, scopeRoot, modelHash) payable -> id
  Root node. Escrowed value = msg.value. Funder recorded for reclaim.
- delegate(parentId, agent, amount, expiry, scopeRoot, modelHash) -> id
  Caller must be the parent's agent. amount moves from parent's remaining
  to the child. Child expiry must be <= parent expiry.
- execute(id, instrument, amount, proofs) -> bool
  Caller must be the mandate's agent. Checks expiry, remaining capacity,
  and merkle proof of instrument against this node's root and every
  ancestor's root. Pass: decrement, extend receipt chain, emit Executed.
  Fail: record Breach at this node, refuse, return false.
- reclaim(id)
  After expiry, remaining capacity returns to the root funder.
- getMandate(id) view, receiptHead(id) view, breachCount(id) view.

Events: MandateCreated, Delegated, Executed, Breach, Reclaimed.

## Deployment

Same WASM, two Orbit chains:

- Robinhood Chain testnet (chain 46630), Stylus v3 confirmed live on ArbWasm.
- Arbitrum Sepolia (chain 421614).

Receipts and roots can additionally anchor into the already-deployed and
verified HeroAnchor contract on Arbitrum Sepolia, extending the existing
Hero proof-of-action deployment rather than replacing it.

## Demo scenario (deterministic)

1. Treasury creates a root mandate: 0.5 ETH capacity, 24h expiry, scope
   root over {ETH-USD, ARB-USD, BTC-USD}, orchestrator model hash.
2. Orchestrator delegates 0.15 ETH to a momentum sub-agent, scope
   {ETH-USD, ARB-USD}, shorter expiry.
3. Sub-agent executes two in-mandate trades. Receipts chain. Both verify.
4. Sub-agent attempts a BTC-USD trade (outside ITS scope even though inside
   the root's): refused, Breach recorded at the sub-agent's node, parent
   chain untouched.
5. Sub-agent attempts an over-capacity trade: refused, Breach recorded.
6. Console shows the tree, capacity flow, receipts, and the two breaches
   attributed to the right node. Explorer links on both chains.

## Honesty rules

- Everything on-chain is real: escrow, narrowing, proofs, receipts, breaches.
- Numeric limits are visible on-chain in this version. Fully sealed numeric
  limits via FHE (CoFHE) are the roadmap and exist as a working integration
  in the Hero fleet demo on Arbitrum Sepolia; they land here when the
  coprocessor is available on target chains. The scope sets are private
  today via merkle commitments.
- Testnet only. No token. No admin keys.
