# Hero Mandate: Chain of Mandate

Delegated authority for autonomous trading agents that provably narrows at
every level of delegation. Enforced by construction, on Arbitrum Stylus.
Same WASM deployed on Robinhood Chain testnet and Arbitrum Sepolia.

Built at Arbitrum Founder House London. Testnet only. No token. No admin
keys.

## What it is

A mandate is an on-chain node: escrowed capacity, committed scope, expiry,
and a model fingerprint. Mandates form a tree. A treasury funds a root
mandate for an orchestrator agent. The orchestrator delegates narrower
mandates to sub-agents. Every execution proves its instrument against the
scope of its whole lineage, decrements capacity, and extends a per-mandate
receipt chain. Out-of-authority attempts are refused and recorded as a
Breach at the exact node that attempted them.

## Why it matters

Multi-agent trading has no enforceable delegation. Session-key and
permission standards grant plaintext authority upfront and verify nothing
after the fact. Audit tools observe agents from outside. Hero Mandate makes
authority itself the enforceable object:

- A sub-agent provably cannot exceed its parent: delegated capacity is
  carved out of the parent's escrowed balance. Delegate 150 of a 500
  mandate and the parent holds 350. No comparison logic to get wrong.
- The strategy stays private: allowed instruments are committed as a merkle
  root. Each execution reveals exactly one leaf and proves it against every
  ancestor's root. No ancestor discloses its set.
- Breaches are attributable: record-and-refuse pins each Breach event to
  the exact mandate node, leaving the parent chain untouched.
- Decision is bound to deed: every receipt folds in the mandate's model
  hash. Receipts chain as head = keccak(prevHead, instrument, amount,
  modelHash, timestamp, blockNumber). One altered byte breaks the chain.
  Anyone can recompute it from events. Tamper evident, not tamper proof.

Hero Mandate never touches execution, custody, routing, or tokenized
securities. It proves agent behaviour. That is why a regulated platform can
adopt it.

## Architecture summary

Full design in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Contract surface (Stylus, Rust):

| Function | Purpose |
| --- | --- |
| `createMandate(agent, expiry, scopeRoot, modelHash)` payable | Root node, escrow = msg.value, funder recorded for reclaim |
| `delegate(parentId, agent, amount, expiry, scopeRoot, modelHash)` | Carve a child out of the parent's remaining capacity, child expiry <= parent |
| `execute(id, instrument, amount, proofs)` | Check expiry, capacity, and merkle proof against this node and every ancestor. Pass: decrement, chain receipt, emit Executed. Fail: record Breach, refuse |
| `reclaim(id)` | After expiry, remaining capacity returns to the root funder |
| `getMandate(id)`, `receiptHead(id)`, `breachCount(id)` | Views |

Events: `MandateCreated`, `Delegated`, `Executed`, `Breach`, `Reclaimed`.

Receipts and roots can additionally anchor into the already deployed and
verified HeroAnchor contract on Arbitrum Sepolia
([sepolia.arbiscan.io](https://sepolia.arbiscan.io/address/0xb3fa3222130fac54b90e37835dce4f052349571b)),
extending the existing Hero proof-of-action deployment.

## Quickstart

Contracts (Rust, Stylus):

```
cd contracts
cargo stylus check
cargo stylus deploy --endpoint <RPC_URL> --private-key <TESTNET_KEY>
```

Agents (deterministic demo scenario: root mandate, delegation, two
in-mandate trades, two refused-and-recorded breach attempts):

```
cd agents
npm install
npm run demo
```

Web console (mandate tree, capacity flow, receipts, breach attribution,
explorer links):

```
cd web
npm install
npm run dev
```

## Deployments

| Chain | Chain ID | Contract | Explorer |
| --- | --- | --- | --- |
| Robinhood Chain testnet | 46630 | `0x0dfca3eabfde4e4714057a326058611e040dcdd9` | [view](https://explorer.testnet.chain.robinhood.com/address/0x0dfca3eabfde4e4714057a326058611e040dcdd9) |
| Arbitrum Sepolia | 421614 | `0x0dfca3eabfde4e4714057a326058611e040dcdd9` | [view](https://sepolia.arbiscan.io/address/0x0dfca3eabfde4e4714057a326058611e040dcdd9) |

Same WASM binary, same address, both chains. Deploy and activation txs in
docs/DEPLOYMENTS.md. Live scenario runs in agents/out/.

## Honesty

- Everything on-chain is real: escrow, narrowing, merkle scope proofs,
  receipt chains, breach records.
- The demo agents are scripted for a deterministic scenario. No orders are
  routed anywhere: the protocol proves authority, venues execute trades.
- Scope sets are private today via merkle commitments. Numeric limits are
  visible on-chain in this version. Fully sealed numeric limits via FHE
  (CoFHE) are the roadmap: the integration exists in the Hero fleet demo on
  Arbitrum Sepolia and lands here when the coprocessor is available on the
  target chains.
- Receipts are tamper evident, not tamper proof.
- Testnet only. No token. No admin keys.

## License

MIT
