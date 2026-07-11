# Deployments

Same WASM binary, same address, two Orbit chains.

| Chain | Chain id | Contract | Deploy tx | Activation tx |
|---|---|---|---|---|
| Robinhood Chain testnet | 46630 | [0x0dfca3eabfde4e4714057a326058611e040dcdd9](https://explorer.testnet.chain.robinhood.com/address/0x0dfca3eabfde4e4714057a326058611e040dcdd9) | [0xf351bacc](https://explorer.testnet.chain.robinhood.com/tx/0xf351bacccd94ec72d4202f1968f4ff282c222d7da6629f503f533242a7f51a40) | 0x71769201c994c9ebd2d0cc3771a2f364003ab00122c2297edbb5874916344192 |
| Arbitrum Sepolia | 421614 | [0x0dfca3eabfde4e4714057a326058611e040dcdd9](https://sepolia.arbiscan.io/address/0x0dfca3eabfde4e4714057a326058611e040dcdd9) | [0x899090f6](https://sepolia.arbiscan.io/tx/0x899090f64b4608856cac9bb92250394e669145225ee4b9c2e80f7ba07b3c525f) | 0x42aaf1b067719ac03b5ddeabd31ed3a164613901f1c3e40d03d1834fa6663ed2 |

Live scenario runs (six beats, receipts and breaches on chain): agents/out/run-robinhood.json and agents/out/run-sepolia.json.

## Cross-primitive anchor

The momentum sub-agent's receipt head from the live Robinhood Chain run,
0x6c642c9fd8684ec9bbef7cdea6ffafb51cff0fc3bb13eb25ea6b2c65d0dbeca6, is
anchored in the verified HeroProofAnchor contract on Arbitrum Sepolia
(0xb3fa3222130fac54b90e37835dce4f052349571b), the same contract that anchors
the Hero robot-fleet proofs. One engine, two industries, provable on chain.

Anchor tx: https://sepolia.arbiscan.io/tx/0x3accefec0cd84166458cec60f4580febd49e305a099ac3e595dc6cd52ccac217
Check it: call verify(0x6c64...beca6) on the anchor contract, returns true.
