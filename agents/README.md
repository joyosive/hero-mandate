# Hero Mandate agents

Deterministic demo runner for the chain of mandate scenario. Needs `../.env` with `DEPLOYER_PRIVATE_KEY`, `RPC_ARB_SEPOLIA`, `RPC_ROBINHOOD`.

    npm install
    npm run selftest
    npx tsx src/run.ts --chain sepolia --address 0xCONTRACT
    npx tsx src/run.ts --chain robinhood --address 0xCONTRACT

Machine summary lands in `out/run-<chain>.json` for the web fixture.

## MPP composition

`src/mpp-guard.ts` answers an Arbitrum MPP (Machine Payments Protocol) payment challenge only after the mandate contract accepts the spend via `execute()`, then signs the credential over the new receipt head.
One line: MPP moves the money, Hero Mandate bounds and proves the authority, and the credential embeds the receipt hash.
Selftest (no chain, mock contract, MPP side labeled SIM): `npx tsx src/mpp-selftest.ts`
Live MPP server integration is roadmap: MPP is v0.1.0 in progress, so the minimal challenge/credential shapes are vendored rather than depended on.
