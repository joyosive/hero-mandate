# Proof of Action log page

A self-contained static page where real people log an action and get a tamper-evident
receipt. It re-themes the community-task prototype to the Hero Mandate brand and runs the
same hash chain as the Hero agent CLI, so a receipt logged here recomputes to the same root.

- URL (after `npm run build` from `web/`, exported to `out/log.html`): `/log.html`
- Honest framing: the recorder is deterministic (rules, not a model). The mandate is shown
  in plaintext on this page; production seals it with Fhenix, already proven live on
  Arbitrum Sepolia. Keys never touch the browser; the team anchors the collected root.

Each action becomes a receipt (`mandate -> task -> decide -> result`, keccak hash-chained).
The session root chains those receipts. To anchor the day's root on-chain:

    node scripts/anchor-session.mjs path/to/session.json

It reads `RPC_ARB_SEPOLIA` and `DEPLOYER_PRIVATE_KEY` from the repo-root `.env` and submits
`anchor(sessionRoot)` to HeroProofAnchor `0xb3fa3222130fac54b90e37835dce4f052349571b`, then
reads `verify()` back. Optional central capture: set `SHEET_ENDPOINT` in `log.html` to a
Google Apps Script `/exec` URL (see `scripts/sheet-capture.gs`) to also collect rows.

Metric line: N actions logged by real people, verified on-chain, anchored into HeroProofAnchor
tx `<fill after anchoring>` (the same contract already live at tx
`0x3accefec0cd84166458cec60f4580febd49e305a099ac3e595dc6cd52ccac217`).
