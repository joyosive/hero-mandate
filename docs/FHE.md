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

## Roadmap (Hero Mandate)
When the CoFHE coprocessor is available on the target chains, the mandate
tree's numeric fields (capacity, remaining) move to encrypted values and the
narrowing checks (child capacity within parent, expiry within parent) run on
ciphertext. The delegation and receipt semantics do not change. Until then we
do not claim sealed numerics, and the console labels FHE as roadmap.
