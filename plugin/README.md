# 🦈 Sharkly

> Hunt the Hedera NFT market with AI.

`hak-sharkly-plugin` — a [Hedera Agent Kit](https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera/hedera-ai-agent-kit) plugin that gives any AI agent natural-language access to the [SentX](https://sentx.io) NFT marketplace on Hedera.

Read-only MVP — exposes the public reporting endpoints (listings, floor, recent activity, top collections, time-series stats). Write endpoints (`buy / list / unlist`) require SentX **affiliate** approval and will be added in a future version.

Built for the Hedera AI Agent Kit (v4, JavaScript/TypeScript). Compatible with LangChain, Vercel AI SDK and ElizaOS via the standard toolkit adapters.

---

## Installation

```bash
npm install hak-sharkly-plugin
```

> Not published to npm yet. While in development, install from a local checkout: `npm install /path/to/hak-sharkly-plugin`.

## Quick start

```ts
import "dotenv/config";
import { Client, PrivateKey } from "@hiero-ledger/sdk";
import { AgentMode } from "@hashgraph/hedera-agent-kit";
import { HederaLangchainToolkit } from "@hashgraph/hedera-agent-kit-langchain";
import { createSharklyPlugin } from "hak-sharkly-plugin";

const client = Client.forMainnet().setOperator(
  process.env.HEDERA_ACCOUNT_ID!,
  PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY!),
);

const sharkly = createSharklyPlugin({
  apiKey: process.env.SENTX_API_KEY!,
});

const toolkit = new HederaLangchainToolkit({
  client,
  configuration: {
    plugins: [sharkly],
    context: { mode: AgentMode.AUTONOMOUS },
  },
});

const tools = toolkit.getTools();
// …wire `tools` into your LangChain / Vercel AI / ADK agent.
```

A full runnable example lives in [`examples/agent.ts`](./examples/agent.ts):

```bash
cp .env.example .env   # fill in SENTX_API_KEY, HEDERA_*, OPENAI_API_KEY
npm install
npm run demo "What's the floor of Dead Pixels Ghost Club today?"
```

---

## Tools

| Tool name                       | What it does                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `sentx_get_listings`            | List NFTs currently for sale in a collection. Filter by traits, user, sort by price/date.     |
| `sentx_get_floor`               | Floor price of a collection (or trait-floor / multi-trait floor).                             |
| `sentx_get_market_activity`     | Recent sales / listings / mints / offers / transfers. Filter by collection, serial, type.     |
| `sentx_get_top_collections`     | Top collections by volume — includes 24h / 7d / 30d / total windows, floor, sales count.      |
| `sentx_get_collection_stats`    | Time-series stats (volume, floor, sales, listings) for a date range. Defaults to last 30 days.|

> Tool names keep the `sentx_*` prefix because they describe the underlying data source. **Sharkly** is the brand / agent; SentX is the API it hunts.

All tools return:

```ts
{
  raw: <full API response>,
  humanMessage: "Human-readable summary string"
}
```

### Example prompts

- "What are the top 5 NFT collections on Hedera right now by 7d volume?"
- "Give me the cheapest 3 Sanctuary Dragons listed."
- "Has anyone bought a Dead Pixels Ghost in the last 24h? Show prices."
- "How has the floor of `0.0.878200` evolved over the last 14 days?"
- "What's the floor for Dead Pixels with the 'Crown' trait?"

---

## Configuration

```ts
createSharklyPlugin({
  apiKey: string,        // required — https://sentx.io/user/settings
  project?: string,      // optional — sent as X-Sentx-Project header
  baseUrl?: string,      // optional — defaults to https://api.sentx.io
});
```

Environment variables consumed by the example agent:

| Variable             | Required | Notes                                            |
| -------------------- | -------- | ------------------------------------------------ |
| `SENTX_API_KEY`      | ✅       | SentX API key.                                   |
| `SENTX_PROJECT`      | ⛔       | Project name issued by SentX (rarely needed).    |
| `HEDERA_NETWORK`     | ⛔       | `mainnet` (default) / `testnet` / `previewnet`.  |
| `HEDERA_ACCOUNT_ID`  | ✅       | Operator account for the Agent Kit client.       |
| `HEDERA_PRIVATE_KEY` | ✅       | Operator key. Read-only mode never signs.        |
| `OPENAI_API_KEY`     | ✅       | Used only by `examples/agent.ts`.                |
| `OPENAI_MODEL`       | ⛔       | Defaults to `gpt-4o-mini`.                       |

> The Hedera Agent Kit needs a `Client` to initialise, so an operator is required even in read-only mode. No HBAR is spent.

---

## Roadmap

- [ ] `sentx_get_offers` — active offers on a collection / NFT.
- [ ] `sentx_get_token_traits` — full trait map for a collection.
- [ ] `sentx_get_user_volume` — wallet activity / volume.
- [ ] **Affiliate (write) endpoints** once approved:
  - `sentx_buy_nft` — buy a listed NFT (signs `CryptoTransferTransaction`).
  - `sentx_list_nft` / `sentx_unlist_nft` — sell flow.

---

## Security

- API key lives in `.env` — never committed (see `.gitignore`).
- The client redacts `apikey` from any URL before throwing or logging.
- Read-only: the plugin does **not** sign or submit any Hedera transaction.

---

## License

MIT — Built by Guillermo ([@aguille_](https://x.com/aguille_)) for the Hedera AI Studio.

Submitted to the Hedera AI Agent Kit ecosystem. SentX API status: **BETA**.
