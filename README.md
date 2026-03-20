# ChainWill

On-chain dead man's switch inheritance on Stellar. Lock XLM for a beneficiary. Check in (ping) regularly to prove you're alive. Miss your check-in deadline and the beneficiary can claim the full balance. The contract is the executor — no lawyers, no intermediaries.

## Live Links
| | |
|---|---|
| **Frontend** | `https://chainwill.vercel.app` |
| **Contract** | `https://stellar.expert/explorer/testnet/contract/CONTRACT_ID` |
| **Proof TX** | `https://stellar.expert/explorer/testnet/tx/TX_HASH` |

## How It Works

1. **Owner** creates a will: deposits XLM, names beneficiary, sets check-in window (e.g. 30 days)
2. **Owner** pings before the deadline — resets the countdown
3. **If owner misses the deadline** — beneficiary can call `claim()` to inherit
4. **Owner can always revoke** while active — funds returned
5. Each ping resets `deadline = current_ledger + check_interval`

## Contract Functions

```rust
create_will(owner, beneficiary, title, note, amount, check_interval, xlm_token) -> u64
ping(owner, will_id)                    // resets deadline
top_up(owner, will_id, amount, xlm_token)
revoke(owner, will_id, xlm_token)       // owner cancels, funds returned
claim(beneficiary, will_id, xlm_token)  // after deadline
get_will(will_id) -> Will
get_owner_wills(owner) -> Vec<u64>
get_beneficiary_wills(beneficiary) -> Vec<u64>
time_until_claimable(will_id) -> u32    // 0 = claim now
count() -> u64
```

## Stack

| Layer | Tech |
|---|---|
| Contract | Rust + Soroban SDK v22 |
| Network | Stellar Testnet |
| Frontend | React 18 + Vite |
| Wallet | Freighter API 6.0.1 |
| Stellar SDK | 14.6.1 |

## Run Locally

```bash
chmod +x scripts/deploy.sh && ./scripts/deploy.sh
cd frontend && npm install && npm run dev
```

---
*Project #30 of 30 — Stellar Soroban Hackathon MOU*
