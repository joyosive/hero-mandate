# hero-fhe-spike

Live Fhenix CoFHE encrypted-authority spike against Arbitrum Sepolia (reads wallet + RPC from `../.env`, never prints secrets).
Run `npm install`, then: `npm run encrypt` (encrypt 500), `npm run grant` (grantAuthority tx), `npm run act` (act tx + proof anchor), `npm run decrypt` (unseal remaining budget via permit).
Targets the deployed ConfidentialAuthority at `0x977b112bc9d121c8f2567c8a52fd7b6a4f2cdd95`; override with `TARGET=0x... AGENT_LABEL=... ACTION_LABEL=...` env vars to rerun with a fresh agent.
Full results, tx hashes, and versions: see `../docs/FHE-SPIKE.md`.
