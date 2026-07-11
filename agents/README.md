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
