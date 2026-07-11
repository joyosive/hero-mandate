#!/usr/bin/env bash
# Deploy HeroMandate to a target chain and record the address.
# Usage: scripts/deploy.sh robinhood|sepolia
set -euo pipefail

cd "$(dirname "$0")/.."
source .env

case "${1:-}" in
  robinhood) RPC="$RPC_ROBINHOOD";  CHAIN_ID="$CHAIN_ID_ROBINHOOD";  NAME="Robinhood Chain testnet"; EXPLORER="https://explorer.testnet.chain.robinhood.com/address/" ;;
  sepolia)   RPC="$RPC_ARB_SEPOLIA"; CHAIN_ID="$CHAIN_ID_ARB_SEPOLIA"; NAME="Arbitrum Sepolia";        EXPLORER="https://sepolia.arbiscan.io/address/" ;;
  *) echo "usage: scripts/deploy.sh robinhood|sepolia" >&2; exit 1 ;;
esac

echo "deploying to $NAME (chain $CHAIN_ID)"
BAL=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC" --ether)
echo "deployer $DEPLOYER_ADDRESS balance: $BAL ETH"

cd contracts
OUT=$(cargo stylus deploy --endpoint "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --no-verify 2>&1 | sed -E "s/\x1B\[[0-9;]*[A-Za-z]//g") || {
  echo "$OUT" | tail -20; exit 1;
}
echo "$OUT" | grep -iE "deployed code|activated|address|tx hash" | head -6

ADDR=$(echo "$OUT" | grep -ioE "deployed code at address:?\s*(0x[a-fA-F0-9]{40})" | grep -ioE "0x[a-fA-F0-9]{40}" | head -1)
[ -n "$ADDR" ] || { echo "could not parse deployed address"; echo "$OUT" | tail -30; exit 1; }

cd ..
mkdir -p docs
touch docs/DEPLOYMENTS.md
printf '%s | %s | %s | %s%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$NAME" "$ADDR" "$EXPLORER" "$ADDR" >> docs/DEPLOYMENTS.md

python3 - "$CHAIN_ID" "$ADDR" <<'EOF'
import json, sys
chain_id, addr = sys.argv[1], sys.argv[2]
p = "web/config/addresses.json"
d = json.load(open(p))
d[chain_id] = addr
json.dump(d, open(p, "w"), indent=2)
print(f"web/config/addresses.json: {chain_id} -> {addr}")
EOF

echo ""
echo "DEPLOYED: $ADDR on $NAME"
echo "explorer: $EXPLORER$ADDR"
