# Where FHE fits

## Today (live in this repo)
Scope privacy via merkle commitments: the instrument universe of every mandate
is committed as a root, never published. Each execution reveals exactly one
leaf and proves it against the whole lineage. Numeric limits are visible.

## Working integration (primitive 1, hero fleet demo)
contracts/fhe/ConfidentialAuthority.sol is the vendored, working Fhenix CoFHE
contract from the Hero fleet demo on Arbitrum Sepolia. The compliance check is
a homomorphic comparison on an encrypted budget: it never branches, never
reverts, and updates remaining authority with FHE.select, so an over-authority
action leaks nothing. Public proof roots anchor through HeroProofAnchor, the
same verified contract this repo anchors trading receipt heads into.

## LIVE (proven 2026-07-11, Arbitrum Sepolia)
The encrypted path now runs for real. Against the deployed
ConfidentialAuthority (0x977b112bc9d121c8f2567c8a52fd7b6a4f2cdd95):

- grantAuthority with a REAL encrypted limit enc(500):
  https://sepolia.arbiscan.io/tx/0x7464ac813c30c4cb773eda602d816a16e1b26a3f6b54c3345491a889c3a27791
- act with enc(40): homomorphic ops through the Fhenix TaskManager, proof
  root anchored through HeroProofAnchor, ActionAnchored emitted:
  https://sepolia.arbiscan.io/tx/0x3833fbdf5b1ee20813bc8ab9afc9e801026b5b3a356e04ed204239b2eac00d1d
- permit-gated decryption readback of remaining authority: 460 = 500 - 40.

Stack: @cofhe/sdk 0.6.1, cofhe-contracts 0.1.4, viem 2.55. Runnable spike in
fhe-spike/. Full log in docs/FHE-SPIKE.md.

## Roadmap (Hero Mandate)
Port the mandate tree's numeric fields (capacity, remaining) to encrypted
values using the exact pattern proven above; narrowing checks run on
ciphertext. Robinhood Chain gets this the moment the coprocessor is available
there (CoFHE currently supports the Sepolia testnets).
