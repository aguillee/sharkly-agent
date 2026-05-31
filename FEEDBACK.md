# Sharkly — Feedback for the Hedera AI Studio team

Notes captured while building **Sharkly** (Week 4 bounty: Enterprise Agent + Plugin). Honest, specific feedback aimed at making the Hedera Agent Kit + the surrounding tooling better for the next wave of builders.

---

## 🎯 The good stuff (don't change this)

### Hedera Agent Kit v4 is a real productivity win
- Going from "I have a Hedera SDK + an LLM" to "I have a working agent with tool-calling" took **hours, not days**.
- The `BaseTool` abstraction is the right level of granularity — clear separation between `normalizeParams`, `coreAction`, `secondaryAction`, `outputParser`, `handleError`.
- The LangChain integration (`@hashgraph/hedera-agent-kit-langchain`) is clean. `createReactAgent` + the auto-registered tools = one screen of code to wire everything up.

### The plugin model works
- Being able to ship a third-party plugin as an npm package with zero coupling to the core kit is the right architecture.
- Lets a marketplace of plugins emerge (one per protocol/dApp). This is **exactly** the right primitive.

---

## ⚠️ Friction points worth addressing

### 1. The v4 `BaseTool` shape isn't documented end-to-end
- The abstract methods (`normalizeParams`, `secondaryAction`, async `shouldSecondaryAction`) are required at runtime but easy to miss because the docs example shows the simplest case.
- Several iterations were wasted with TypeScript errors like `Class extends BaseTool incorrectly implements interface` because the abstract method list isn't surfaced clearly.
- **Suggestion:** add a "minimum viable tool" template in the docs that lists every required method with a one-line description, and a "full tool" template with `secondaryAction` + `outputParser` examples.

### 2. The Agent Kit assumes a single operator account
- The kit's `Client` is instantiated with one operator at boot. For a multi-tenant agent (e.g. one server, many users), there's no first-class way to swap the signer per-request.
- I worked around it by treating the server's operator as "the seller" and having the frontend manage the user identity — but that doesn't extend to a real production app where each user needs to sign with their own wallet (WalletConnect).
- **Suggestion:** consider a per-invocation context that can inject a different signer / operator without re-instantiating the whole client.

### 3. v3 → v4 docs gap
- A lot of community examples on GitHub are v3 (`Tool` object literal style) and don't work in v4. The migration isn't obvious unless you read the v4 source.
- **Suggestion:** a top-of-page banner on v3 docs pointing to v4, and a concrete "v3 → v4 migration in 10 lines" cheatsheet.

### 4. Tool result parsing is implicit
- An `outputParser` that returns `{ raw, humanMessage }` works, but it's not documented what LangChain does with this shape downstream. I had to read source to figure out that `humanMessage` gets shown to the LLM and `raw` is what your `outputParser` consumer sees.
- **Suggestion:** document the contract between `outputParser` output and what flows to the LLM vs what your server can introspect.

---

## 🔧 SentX integration learnings (might help the next plugin author)

### Affiliate auth was undocumented for the JS world
- The SentX OpenAPI spec describes `/auth/init` + `/auth/verify` but doesn't explain that the signature payload must be EIP-191-style wrapped:
  ```
  \x19Hedera Signed Message:\n{len(json)}{json}
  ```
- Spent several hours on signature mismatches trying every reasonable wrapping scheme.
- **For SentX:** publish a tiny `@sentx/affiliate-sdk` (even 30 lines) showing the exact signing flow in TypeScript. Would unlock dozens of agent-style integrations overnight.

### `unlistnft` was not enabled by default
- The endpoint is documented in the API but returns `403 "Endpoint not enabled for this account"` until SentX manually whitelists your affiliate key.
- A note in the OpenAPI docs ("contact support to enable write endpoints") would save a debugging round-trip.

### EVM unlisting collection-wide gotcha
- For EVM-native NFTs, the unlist is `setApprovalForAll(operator, false)` — collection-wide, not per-NFT.
- If the seller has other live SentX listings of the same ERC contract, they all silently break until SentX's sanitizer auto-delists them.
- **For SentX:** consider warning the affiliate explicitly in the API response (`requiresPostListingSanitize: true` or similar) so agents can show a clear modal.

---

## 💡 Things I wish existed

1. **A canonical `@hedera-agent-kit/wallet-connect` adapter** — every dApp on Hedera needs WalletConnect; bundling a first-party adapter for the Agent Kit would 10× the "production-readiness" of any agent.
2. **A starter template per bounty week** — e.g. `npx create-hedera-agent --plugin sentx` that drops a working monorepo skeleton with the exact structure (plugin + agent + UI + Vercel config) the bounty expects.
3. **A community plugin registry** — a simple website where plugins can be discovered and rated. Right now you have to know the npm package name to find anything.
4. **Mainnet wallet "demo mode"** for the Agent Kit — a way to dry-run tool calls against a forked / sandboxed mirror node without spending real HBAR. Critical for the contest flow ("how do I demo a buy without spending 50 HBAR every time I record?").

---

## 🙏 Thanks

Genuinely had fun shipping this. The fact that I could go from zero to a working non-custodial NFT agent in a few days says good things about the kit. Looking forward to v5 (and maybe contributing the WalletConnect adapter myself).

— Guillermo ([@aguille_](https://x.com/aguille_))
