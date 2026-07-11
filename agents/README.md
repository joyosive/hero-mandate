# Hero Mandate agents

Deterministic demo runner for the chain of mandate scenario. Needs `../.env` with `DEPLOYER_PRIVATE_KEY`, `RPC_ARB_SEPOLIA`, `RPC_ROBINHOOD`.

    npm install
    npm run selftest
    npx tsx src/run.ts --chain sepolia --address 0xCONTRACT
    npx tsx src/run.ts --chain robinhood --address 0xCONTRACT

Machine summary lands in `out/run-<chain>.json` for the web fixture.
