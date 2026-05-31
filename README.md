# 🦈 Sharkly — Hedera AI Agent

> Hunt the Hedera NFT market with AI.

Sharkly is a conversational AI agent that turns the entire [SentX](https://sentx.io) NFT marketplace on Hedera into a chat interface. Browse collections, check floor prices, inspect your wallet, and execute **real on-chain transactions** — buying, listing, and unlisting NFTs — all through natural language.

Built for the **Hedera AI Studio — Week 2: Enterprise Agent + Plugin** bounty.

---

## 📦 Repo layout

```
sharkly-agent/
├── plugin/             ← The custom Hedera Agent Kit plugin (22 tools)
│   └── src/
│       ├── sentx-client.ts
│       └── tools/
├── server.js           ← Express backend (chat + execute-* endpoints)
├── public/             ← Vanilla-JS chat UI (light-blue iMessage style)
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── api/index.js        ← Vercel serverless entry
```

The plugin is a local-file dependency (`file:./plugin`) so the whole thing installs with a single `npm install` flow.

---

## ✨ What Sharkly can do

### 22 tools, one plugin

**Read (18 tools)** — every public SentX endpoint:
- `sentx_get_listings`, `sentx_get_floor`, `sentx_get_market_activity`
- `sentx_get_top_collections`, `sentx_get_collection_stats`, `sentx_get_aggregated_stats`
- `sentx_get_offers`, `sentx_get_token_owners`, `sentx_get_token_traits`
- `sentx_get_token_nfts`, `sentx_get_user_volume`, `sentx_get_market_events`
- `sentx_get_supported_tokens`, `sentx_is_token_supported`, `sentx_get_transactions`
- `sentx_get_launchpad_activity`, `sentx_get_mint_events`, `sentx_generate_prng`

**Write (3 tools)** — affiliate-protected, non-custodial:
- `sentx_buy_nft` — buys the NFT atomically (auto-associates token if needed)
- `sentx_list_nft` — non-custodial allowance approve (NFT never leaves the seller's wallet)
- `sentx_unlist_nft` — granular per-NFT allowance revoke

**Wallet introspection (1 tool)**:
- `get_my_wallet_nfts` — queries the mirror node for the operator's NFT holdings

### 🔒 Non-custodial by design

Your NFT **never leaves your wallet** during listing. SentX gets an HTS `AccountAllowanceApproveTransaction` granting permission to move that **specific serial** if and when a buyer pays. Unlisting issues a granular `AccountAllowanceDeleteTransaction` to revoke it.

EVM-native unlistings (which would be collection-wide via `setApprovalForAll(false)`) are rejected with a clear error to avoid silently breaking other live listings.

### 🪞 Confirmation modals for every write

The agent **never signs silently**. Every buy / list / unlist surfaces a modal in the UI with the exact transaction details and waits for the user to click **Confirm**.

### 📊 Live mirror-node analytics

Side panel shows the operator wallet's NFT transaction history pulled from `mainnet-public.mirrornode.hedera.com`, with a "via Sharkly" badge on agent-originated transfers.

---

## 🚀 Quick start

```bash
git clone https://github.com/aguillee/sharkly-agent.git
cd sharkly-agent

# 1) Compile the plugin
cd plugin && npm install && npm run build && cd ..

# 2) Install the agent
npm install

# 3) Configure your env
cp .env.example .env
# Then edit .env — see "Env vars" below

# 4) Run
npm start
# → http://localhost:3000
```

### Env vars

The agent needs:
- **SENTX_API_KEY** — generate at https://sentx.io/user/settings
- **SENTX_AFFILIATE_KEY** + **HEDERA_AFFILIATE_***  — request affiliate access from SentX (required for buy/list/unlist)
- **HEDERA_ACCOUNT_ID** + **HEDERA_PRIVATE_KEY** — a DEDICATED mainnet wallet (NOT your main wallet) with 30-50 HBAR for the demo
- **ANTHROPIC_API_KEY** OR **AI_GATEWAY_API_KEY** — for the LLM

See [`.env.example`](.env.example) for the full template with comments.

---

## 🏗️ Architecture

```
┌──────────────────────┐
│   Browser (UI)       │
│   - Wallet pill      │
│   - Chat composer    │
│   - Confirm modals   │
└──────────┬───────────┘
           │ POST /api/chat
           ▼
┌──────────────────────────────────────────┐
│   Express server (sharkly-agent)         │
│                                          │
│   LangChain + Hedera Agent Kit v4        │
│        ├─ 22 SentX tools (plugin/)       │
│        └─ Pending op stores (5min TTL)   │
│                                          │
│   /api/execute-purchase                  │
│   /api/execute-listing                   │
│   /api/execute-unlisting                 │
└──────┬───────────────┬───────────────────┘
       │               │
       ▼               ▼
   SentX API     Hedera mainnet
                 (sign + submit
                  AccountAllowance*Txs)
```

### Two-phase non-custodial write flow

1. **Prepare:** tool calls SentX → gets unsigned `transBytes` + `saleVerificationCode` → stores pending op with UUID.
2. **Confirm:** user clicks "Confirm & sign" in the modal.
3. **Execute:** server reconstructs the tx with `Transaction.fromBytes`, signs with the operator key, submits to Hedera mainnet.
4. **Ping back:** server calls SentX `/buynftres` (or `/listnftres`, `/unlistnftres`) with the `transactionId` → marketplace state updates.

---

## 💬 Example prompts

```
What are the top 5 NFT collections on Hedera by 7d volume?
What's the floor of Dead Pixels Ghost Club today?
Show me the last 10 sales of token 0.0.878200.
Buy the cheapest Hotdog Hustle NFT (0.0.857979) for me
What NFTs do I have in my wallet?
List my NFT 0.0.857979 serial 5710 for 3 HBAR
Unlist my NFT 0.0.857979 serial 5710
Generate a fair random number between 1 and 100 on-chain
```

---

## ☁️ Deploy to Vercel

```bash
vercel link
vercel env add SENTX_API_KEY
vercel env add SENTX_AFFILIATE_KEY
vercel env add HEDERA_ACCOUNT_ID
vercel env add HEDERA_PRIVATE_KEY
vercel env add HEDERA_AFFILIATE_ACCOUNT_ID
vercel env add HEDERA_AFFILIATE_PRIVATE_KEY
vercel env add ANTHROPIC_API_KEY
vercel deploy --prod
```

The `vercel.json` handles building the plugin before deploying.

---

## 🗺️ Roadmap

- [ ] WalletConnect integration (HashPack/Kabila) — let any user use Sharkly with their own wallet
- [ ] Per-wallet usage caps (token-based) backed by Supabase
- [ ] Stripe subscription tiers (Free / Premium / Pro)
- [ ] Watchlists with floor-price alerts
- [ ] Multi-step research workflows (orchestrated sub-agents)

---

## 🔐 Security notes

- **No private keys in this repo.** All secrets live in `.env` (gitignored).
- **Operator-mismatch guards** on every execute endpoint.
- **Pending ops consumed atomically** — single-use UUIDs, can't be replayed.
- **5-minute TTL** on every pending op.

---

## 📄 License

MIT — see [LICENSE](./LICENSE).

---

## 🦈 Built by

[Guillermo Cámara](https://x.com/aguille_) — Hedera ambassador in Spain, founder of Santuario Hedera.

Honest feedback on the Hedera Agent Kit + SentX integration is in [FEEDBACK.md](./FEEDBACK.md).
