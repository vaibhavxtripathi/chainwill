#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
gh repo create chainwill --public \
  --description "ChainWill — On-chain dead man's switch inheritance. Ping to prove you're alive. Miss the deadline — heirs inherit. Stellar Soroban." \
  --source "${ROOT}" --remote origin --push
ENV="${ROOT}/frontend/.env"
CONTRACT_ID=$(grep VITE_CONTRACT_ID "$ENV" | cut -d= -f2 | tr -d '[:space:]')
XLM_TOKEN=$(grep VITE_XLM_TOKEN "$ENV" | cut -d= -f2 | tr -d '[:space:]')
USER=$(gh api user -q .login)
gh secret set VITE_CONTRACT_ID --body "$CONTRACT_ID" --repo "$USER/chainwill"
gh secret set VITE_XLM_TOKEN   --body "$XLM_TOKEN"   --repo "$USER/chainwill"
cd "${ROOT}/frontend" && vercel --prod --yes
echo "✓ ChainWill published! All 30 projects complete."
