# Hero Mandate operator cockpit

A LOCAL, click-driven web cockpit that fires the REAL on-chain steps from `flow.ts` and `settle.ts`, one button per step, so the demo can be screen-recorded with mouse clicks instead of a terminal. It serves a static page at http://localhost:5599 and exposes `POST /api/step/<1..8>`, each running one real action on the selected chain (Robinhood Chain 46630 by default, or Arbitrum Sepolia 421614) and returning `{ ok, txHash, explorerUrl, network, summary }`.

Run:
- `npm run cockpit` then open http://localhost:5599
- `npm run cockpit -- --dry` wires every endpoint but fires no transaction (useful to smoke-test)

Local-only key: the signing key is loaded from `../.env` into this Node process only. All signing happens server-side; the browser never receives the key and no API response or log line contains it. Do not deploy this server.

Recording tip: start the cockpit, screen-record http://localhost:5599 while clicking RUN down the 8 steps (each shows a live tx hash and a clickable explorer link), then switch the recording to the read-only public site at hero-mandate.netlify.app to close.
