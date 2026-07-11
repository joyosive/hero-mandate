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
