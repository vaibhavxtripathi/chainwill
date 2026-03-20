#!/usr/bin/env bash
set -e
GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}CHAINWILL — DEPLOY${NC}"

for KEY in owner1 heir1; do
  stellar keys generate --global ${KEY} --network testnet 2>/dev/null || true
done
stellar keys fund owner1 --network testnet
stellar keys fund heir1  --network testnet
OWNER=$(stellar keys address owner1)
HEIR=$(stellar keys address heir1)
XLM_TOKEN=$(stellar contract id asset --asset native --network testnet)
echo -e "${GREEN}✓ Owner: ${OWNER}${NC}"
echo -e "${GREEN}✓ Heir : ${HEIR}${NC}"

cd contract
cargo build --target wasm32-unknown-unknown --release
WASM="target/wasm32-unknown-unknown/release/chainwill.wasm"
cd ..

WASM_HASH=$(stellar contract upload --network testnet --source owner1 --wasm contract/${WASM})
CONTRACT_ID=$(stellar contract deploy --network testnet --source owner1 --wasm-hash ${WASM_HASH})
echo -e "${GREEN}✓ CONTRACT_ID: ${CONTRACT_ID}${NC}"

# Owner creates a will — 10 XLM, must ping every 30 days (~518400 ledgers)
stellar contract invoke --network testnet --source owner1 --id ${XLM_TOKEN} \
  -- approve --from ${OWNER} --spender ${CONTRACT_ID} \
  --amount 200000000 --expiration_ledger 3110400 2>&1 || true

TX_RESULT=$(stellar contract invoke \
  --network testnet --source owner1 --id ${CONTRACT_ID} \
  -- create_will \
  --owner ${OWNER} \
  --beneficiary ${HEIR} \
  --title '"My Stellar Inheritance"' \
  --note '"If you are reading this, I have not checked in for 30 days. These XLM are yours."' \
  --amount 100000000 \
  --check_interval 518400 \
  --xlm_token ${XLM_TOKEN} 2>&1)

TX_HASH=$(echo "$TX_RESULT" | grep -oP '[0-9a-f]{64}' | head -1)

# Owner pings to prove alive
stellar contract invoke --network testnet --source owner1 --id ${CONTRACT_ID} \
  -- ping --owner ${OWNER} --will_id 1 2>&1 || true

echo -e "${GREEN}✓ Proof TX: ${TX_HASH}${NC}"

cat > frontend/.env << EOF
VITE_CONTRACT_ID=${CONTRACT_ID}
VITE_XLM_TOKEN=${XLM_TOKEN}
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
EOF

echo -e "${CYAN}CONTRACT : ${CONTRACT_ID}${NC}"
echo -e "${CYAN}PROOF TX : ${TX_HASH}${NC}"
echo "Next: cd frontend && npm install && npm run dev"
