# FHE Spike: first live encrypted-authority transactions on Arbitrum Sepolia

Date: 2026-07-11. Runnable code: `fhe-spike/` (see its README).

## Result: LIVE, full loop

The deployed `ConfidentialAuthority` at
[`0x977b112bc9d121c8f2567c8a52fd7b6a4f2cdd95`](https://sepolia.arbiscan.io/address/0x977b112bc9d121c8f2567c8a52fd7b6a4f2cdd95)
had zero events since deployment. It now has its first real encrypted grant and its
first real encrypted action, with the proof root publicly anchored in
`HeroProofAnchor`, and the resulting encrypted budget was decrypted off-chain via a
CoFHE permit to the exact expected value. No redeploy was needed: the contract is
fully compatible with the current CoFHE stack (its bytecode embeds the current
TaskManager address, and the `InEuint32` ABI matches `cofhe-contracts` 0.1.4).

## Transactions

1. `grantAuthority(agentId, enc(500))`
   - tx [`0x7464ac813c30c4cb773eda602d816a16e1b26a3f6b54c3345491a889c3a27791`](https://sepolia.arbiscan.io/tx/0x7464ac813c30c4cb773eda602d816a16e1b26a3f6b54c3345491a889c3a27791)
   - block 286311569, status success, gasUsed 178536
   - emitted `AuthorityGranted` (topic0 `0x05f7f7093c457aa9cbec6c5653eade14a78ea4f0302223b0ab49760664b821d5`, verified against `keccak("AuthorityGranted(bytes32,address)")`)
   - `agentId = keccak("hero-mandate-spike-1") = 0xa777fe7893729b459248ab7bbfad425a838670aafae53045c023001f36d2f3e1`
   - encrypted input ctHash `0xf4688c162896a8e7881fa7581c3e1656a45fee76960c92c91047dab9de45f7e9` (utype 4 = euint32, securityZone 0, 65-byte verifier signature)

2. `act(agentId, enc(40), proofRoot)`
   - tx [`0x3833fbdf5b1ee20813bc8ab9afc9e801026b5b3a356e04ed204239b2eac00d1d`](https://sepolia.arbiscan.io/tx/0x3833fbdf5b1ee20813bc8ab9afc9e801026b5b3a356e04ed204239b2eac00d1d)
   - block 286311710, status success, gasUsed 355885
   - `proofRoot = keccak("spike-action-1") = 0xf9b446df75067104c73844aeb3f4859d03a91471ea53a765cf08fe8e058e9015`
   - encrypted input ctHash `0xa84893d8e3d89975ebd5b8ccfc5dadf603f75c667e11c6339cf8c8677185fac8`
   - 5 logs in one tx, the whole story in order:
     - 3 logs from the CoFHE TaskManager `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9`: the homomorphic ops (`lte`, `sub`, `select`) dispatched to the coprocessor
     - `ProofAnchored` on HeroProofAnchor `0xb3fa3222130fac54b90e37835dce4f052349571b`
     - `ActionAnchored` on ConfidentialAuthority (topic0 verified against `keccak("ActionAnchored(bytes32,bytes32,uint64,uint64)")`)
   - post-tx check: `HeroProofAnchor.verify(proofRoot)` returns `anchored=true, timestamp=1783757966, submitter=0x977b112BC9d121C8f2567c8A52fd7B6a4f2cdD95` (the ConfidentialAuthority contract itself, as designed)

3. Off-chain decrypt (no tx, permit-gated)
   - `remainingAuthority(operator, agentId)` handle: `0x15bee52541f9c433d39887ba5bb989164d6a6f7f3423f2c1f5f588b4511e0400`
   - self-permit created via `client.permits.getOrCreateSelfPermit()`, then `decryptForView(handle, FheTypes.Uint32)`
   - decrypted value: **460**, exactly 500 granted minus 40 acted. This proves the coprocessor really executed the homomorphic subtraction on ciphertext on-chain.

Operator wallet: `0x73e702E06ECaFc8e143fd5e70CB1BA21C53c7e9c`. Total gas spend for both txs: about 0.0000107 ETH (budget was 0.005).

## Exact versions and endpoints

- Node 22.14.0, viem 2.55.0
- `@cofhe/sdk` 0.6.1 (current SDK from the [cofhesdk monorepo](https://github.com/FhenixProtocol/cofhesdk); docs quickstart pins `^0.5.2`, compatibility page lists 0.5.2 as minimum)
- `@fhenixprotocol/cofhe-contracts` 0.1.4 (latest; `InEuint32 = { uint256 ctHash; uint8 securityZone; uint8 utype; bytes signature }`)
- CoFHE system contract on Arbitrum Sepolia (chain 421614): TaskManager `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9`, hardcoded in `FHE.sol` and present in the deployed ConfidentialAuthority bytecode (checked; the older `0x...98516403C89939` address is not embedded, so no version drift)
- CoFHE service endpoints for `arb-sepolia` (from `@cofhe/sdk/chains`): coprocessor `https://testnet-cofhe.fhenix.zone`, verifier `https://testnet-cofhe-vrf.fhenix.zone`, threshold network `https://testnet-cofhe-tn.fhenix.zone`

## What was attempted, in order

1. Recon: fetched `https://cofhe-docs.fhenix.zone/llms.txt`, the JavaScript quickstart, and the compatibility page; confirmed Arbitrum Sepolia is fully supported (`arb-sepolia`, API v1) and that the canonical JS path is `createCofheConfig` + `createCofheClient` from `@cofhe/sdk/node`, `client.connect(publicClient, walletClient)` with viem, then `client.encryptInputs([Encryptable.uint32(500n)]).execute()`.
2. Live encrypt of 500: succeeded first try in 11.6s total (fetchKeys 4.9s, ZK prove 5.7s, verifier accept 1.0s). Encryption steps observed: `initTfhe, fetchKeys, pack, prove, verify`.
3. `grantAuthority` on the old contract: simulated first, then sent. Success, first event ever on the contract.
4. `act` with encrypted 40: success, ActionAnchored plus ProofAnchored in the same tx.
5. Decrypt remaining budget via permit: 460, matching expectation.

Nothing failed. The previously suspected version drift does not exist; the deployed
contract was simply never called with a real encrypted input before.

## Conclusion

LIVE: the full encrypted-authority beat (encrypt, grant, act, anchor, decrypt) ran end to end on Arbitrum Sepolia against the already-deployed ConfidentialAuthority.
Every layer worked: key fetch, ZK-proven input encryption, on-chain verifier, TaskManager homomorphic ops, public proof anchoring, and permit-gated decryption.
No blockers remain for wiring this into the Hero Mandate demo; rerun anytime with `cd fhe-spike && npm run grant` using a fresh `AGENT_LABEL`.
