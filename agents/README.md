# Hero Mandate agents

Deterministic demo runner for the chain of mandate scenario. Needs `../.env` with `DEPLOYER_PRIVATE_KEY`, `RPC_ARB_SEPOLIA`, `RPC_ROBINHOOD`.

    npm install
    npm run selftest
    npx tsx src/run.ts --chain sepolia --address 0xCONTRACT
    npx tsx src/run.ts --chain robinhood --address 0xCONTRACT

Machine summary lands in `out/run-<chain>.json` for the web fixture.

## MPP composition

`src/mpp-guard.ts` answers an Arbitrum MPP (Machine Payments Protocol) payment challenge only after the mandate contract accepts the spend via `execute()`.
The guard emits credentials in `@arbitrum/mpp`'s permit2 wire format, built with the package's own `createChallengeHash` and `buildPermit2TypedData` primitives: the mandate receipt head from the `Executed` event is bound through the challenge hash realm (`hero-mandate/<receiptHead>`), so a payment credential cannot exist without on-chain authority.
One line: MPP moves the money, Hero Mandate bounds and proves the authority, and MPP's own challenge hash embeds the receipt head.
Selftest (no chain, mock contract, challenge side labeled SIM): `npx tsx src/mpp-selftest.ts`
Full Charge server round trip is roadmap.

## Full flow

The complete stage story in one command:

    npx tsx src/flow.ts --chain robinhood --address 0xCONTRACT [--step] [--no-anchor]

Beats 1 to 6 are the chain of mandate scenario from `run.ts`: root mandate, momentum sub-mandate, two in-mandate trades with lineage proofs, a scope breach, a capacity breach, and receipt chain verification. `flow.ts` then adds:

- Beat 7, machine payment under mandate: the orchestrator carves a 0.0005 ETH payments sub-mandate (scope `PAY-USDC` only, expiry now+6h) for an ops agent. An MPP challenge for a market data feed is executed on-chain, and only then is the permit2 credential signed, bound to the new receipt head through the challenge hash realm. A second, oversized challenge is refused with breach code 2 and no credential exists. No mandate, no payment.
- Beat 8, cross-chain anchor (robinhood runs only, skip with `--no-anchor`): the momentum node's final receipt head from this run is anchored into the verified `HeroProofAnchor` contract on Arbitrum Sepolia (`0xb3fa3222130fac54b90e37835dce4f052349571b`), the same contract that anchors the Hero robot-fleet proofs, then read back with `verify()`.

`--step` gates each beat on Enter for presenting. Machine summary lands in `out/flow-<chain>.json`.

Cost per rehearsal: about 0.0065 ETH on the demo chain plus dust on Sepolia for the anchor tx. Most of that (0.005 ETH) is escrowed mandate capacity, not burned: it returns to the treasury after expiry via `reclaim()`.

## Real settlement

Real Circle testnet USDC moves on Arbitrum Sepolia, gated by an on-chain mandate:

    npx tsx src/settle.ts [--token usdc|demo] [--step]

What happens, all real transactions with Arbiscan links:

1. Treasury creates (or reuses) a payments mandate on the deployed `HeroMandate` (`0x0dfca3eabfde4e4714057a326058611e040dcdd9`): 0.002 ETH escrowed capacity, scope root over `PAY-USDC` only, granted directly to the ops agent (derived index 3).
2. The ops agent answers a payment challenge through `MandateGuard`: the mandate contract accepts the spend via `execute()` on-chain first, then the agent signs the `@arbitrum/mpp` permit2 credential over the REAL token address, bound to the new receipt head, with a timestamp-derived unordered nonce verified unspent in Permit2's `nonceBitmap`.
3. The vendor (derived index 4) redeems the credential on canonical Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) via `permitWitnessTransferFrom`, with the hashed `PaymentWitness` struct and the package's own `PERMIT2_WITNESS_TYPE_STRING`. 5 tokens move from the ops agent to the vendor.
4. The identical credential is replayed and Permit2 reverts with `InvalidNonce()`, mined on-chain as a reverted transaction: the credential is single-use.

Token: `--token usdc` (default) settles real Circle testnet USDC (`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`); when neither the treasury nor the ops agent holds any, it prints the faucet instruction (claim at faucet.circle.com to the treasury address) and falls back to the demo token. `--token demo` deploys or reuses `Hero Demo USD` (`hUSD`, 6 decimals, fixed supply, source and precompiled bytecode in `src/erc20.ts`, deployment recorded in `out/settle-token.json`).

Live run, real USDC (challenge `chg-settle-002`, mandate 3):

- mandate execute: https://sepolia.arbiscan.io/tx/0x07cd445e36462442cdad34e4a6c900bbdc16467efa42a6f2f83e8e19ef5f464b
- settlement (5.0 USDC ops -> vendor): https://sepolia.arbiscan.io/tx/0x612a1094866ade49930ac002443e1b7b3eecb72d512b784a3aceb88194f97582
- replay refused (reverted, `InvalidNonce()`): https://sepolia.arbiscan.io/tx/0x066d35c31b9a7a19a50a12e0bd1059bc8d7d53bfb2ad9fa2aec140449532d0a9

Honest note on units: mandate capacity is escrowed ETH wei and acts as abstract authority units; the token amount is a separate ledger. The demo aligns them 1:1 (a 5.000000 token settlement decrements 5000000 authority units) so one number tells both stories, but the escrow does not custody the tokens: Permit2 moves the tokens, the mandate bounds and proves the authority.

Machine summary lands in `out/settle-sepolia.json` (real USDC run; the earlier demo-token run is preserved in `out/settle-sepolia-demo.json`). Cost per fresh run: about 0.003 ETH, of which 0.002 ETH is reclaimable escrow; reruns that reuse the mandate cost dust.
