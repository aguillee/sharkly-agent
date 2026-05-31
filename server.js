// server.js
//
// Sharkly — Express server with web chat UI. STATELESS for chat history
// (it travels in the request body from the browser's localStorage).
//
// Pending NFT purchases are kept in memory through the plugin's shared
// pending-purchase store (single-process; for multi-instance deploys
// swap that store for Redis / Vercel KV).
//
// LLM: Vercel AI Gateway (https://vercel.com/docs/ai-gateway).
//
// Run locally:
//   npm install
//   npm start
// Then open http://localhost:3000

import dotenv from 'dotenv';
dotenv.config({ override: true });

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Client, PrivateKey, Transaction, TokenAssociateTransaction } from '@hiero-ledger/sdk';
import { AgentMode } from '@hashgraph/hedera-agent-kit';
import { HederaLangchainToolkit } from '@hashgraph/hedera-agent-kit-langchain';
import { createAgent } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';

import {
  createSharklyPlugin,
  consumePendingPurchase,
  getPendingPurchase,
  consumePendingListing,
  consumePendingUnlisting,
} from 'hak-sharkly-plugin';

// ─── Env ───────────────────────────────────────────────────────────
function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`X Missing env var ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

const SENTX_API_KEY = required('SENTX_API_KEY');
const SENTX_AFFILIATE_KEY = process.env.SENTX_AFFILIATE_KEY;
const PORT = Number(process.env.PORT ?? 3000);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
if (!ANTHROPIC_API_KEY && !AI_GATEWAY_API_KEY) {
  console.error('X No LLM key found. Set ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY.');
  process.exit(1);
}

const HEDERA_NETWORK = (process.env.HEDERA_NETWORK ?? 'mainnet').toLowerCase();
const HEDERA_ACCOUNT_ID = required('HEDERA_ACCOUNT_ID');
const HEDERA_PRIVATE_KEY = required('HEDERA_PRIVATE_KEY');

// Affiliate wallet — separate from the buyer operator. Used ONLY to sign
// SentX's wallet-auth challenge (no on-chain transactions). Optional: if
// missing, the buy_nft tool stays disabled and Sharkly runs read-only.
const HEDERA_AFFILIATE_ACCOUNT_ID = process.env.HEDERA_AFFILIATE_ACCOUNT_ID;
const HEDERA_AFFILIATE_PRIVATE_KEY = process.env.HEDERA_AFFILIATE_PRIVATE_KEY;

const MODEL = process.env.LLM_MODEL ?? 'anthropic/claude-haiku-4-5';

// ─── Hedera client (mainnet by default; required for signing buys) ─
const client =
  HEDERA_NETWORK === 'testnet'
    ? Client.forTestnet()
    : HEDERA_NETWORK === 'previewnet'
      ? Client.forPreviewnet()
      : Client.forMainnet();

// Auto-detect ECDSA vs ED25519 from the key format.
const operatorKey = HEDERA_PRIVATE_KEY.startsWith('0x')
  ? PrivateKey.fromStringECDSA(HEDERA_PRIVATE_KEY)
  : PrivateKey.fromString(HEDERA_PRIVATE_KEY);
client.setOperator(HEDERA_ACCOUNT_ID, operatorKey);

// ─── Build the agent ───────────────────────────────────────────────
const sharklyPlugin = createSharklyPlugin({
  apiKey: SENTX_API_KEY,
  affiliateKey: SENTX_AFFILIATE_KEY,
  affiliateAccountId: HEDERA_AFFILIATE_ACCOUNT_ID,
  affiliatePrivateKey: HEDERA_AFFILIATE_PRIVATE_KEY,
  project: process.env.SENTX_PROJECT,
  network: HEDERA_NETWORK,
});

const toolkit = new HederaLangchainToolkit({
  client,
  configuration: {
    tools: [],
    plugins: [sharklyPlugin],
    context: { mode: AgentMode.AUTONOMOUS, accountId: HEDERA_ACCOUNT_ID },
  },
});

const tools = toolkit.getTools();

const sharklyToolNames = new Set([
  'sentx_get_listings',
  'sentx_get_floor',
  'sentx_get_market_activity',
  'sentx_get_market_events',
  'sentx_get_offers',
  'sentx_get_top_collections',
  'sentx_get_user_volume',
  'sentx_get_collection_stats',
  'sentx_get_aggregated_stats',
  'sentx_get_transactions',
  'sentx_get_launchpad_activity',
  'sentx_get_mint_events',
  'sentx_is_token_supported',
  'sentx_get_supported_tokens',
  'sentx_get_token_nfts',
  'sentx_get_token_owners',
  'sentx_get_token_traits',
  'sentx_generate_prng',
  'sentx_buy_nft',
  'sentx_list_nft',
  'sentx_unlist_nft',
  'get_my_wallet_nfts',
]);

// ─── LLM (Anthropic direct first, Vercel Gateway as fallback) ──────
let llm;
let llmProviderLabel;

if (ANTHROPIC_API_KEY) {
  // Direct Anthropic API. Model id should NOT carry a provider prefix.
  const modelId = MODEL.replace(/^anthropic\//, '');
  llm = new ChatAnthropic({
    apiKey: ANTHROPIC_API_KEY,
    model: modelId,
    temperature: 0,
  });
  llmProviderLabel = `Anthropic direct · ${modelId}`;
} else {
  // Vercel AI Gateway (OpenAI-compatible). Model id needs a provider prefix.
  const modelId = MODEL.includes('/') ? MODEL : `anthropic/${MODEL}`;
  llm = new ChatOpenAI({
    apiKey: AI_GATEWAY_API_KEY,
    model: modelId,
    temperature: 0,
    configuration: { baseURL: 'https://ai-gateway.vercel.sh/v1' },
  });
  llmProviderLabel = `Vercel AI Gateway · ${modelId}`;
}

const SYSTEM_PROMPT = [
  'You are Sharkly — a Hedera AI agent that hunts the SentX NFT marketplace.',
  '',
  'Read tools: sentx_get_listings, sentx_get_floor, sentx_get_market_activity,',
  '  sentx_get_market_events, sentx_get_offers, sentx_get_top_collections,',
  '  sentx_get_user_volume, sentx_get_collection_stats, sentx_get_aggregated_stats,',
  '  sentx_get_transactions, sentx_get_launchpad_activity, sentx_get_mint_events,',
  '  sentx_is_token_supported, sentx_get_supported_tokens, sentx_get_token_nfts,',
  '  sentx_get_token_owners, sentx_get_token_traits, sentx_generate_prng.',
  '',
  'Write tools (the UI asks for confirmation, you DO NOT):',
  '  - sentx_buy_nft   — prepare a purchase. Call sentx_get_listings FIRST to get the',
  '                       current price and serial.',
  '  - sentx_list_nft  — prepare a listing (sell). The seller must own the NFT. Call',
  '                       sentx_get_token_owners FIRST if you want to verify ownership.',
  '  - sentx_unlist_nft — remove an active listing. The seller must currently have the',
  '                       NFT listed on SentX.',
  '',
  'Both write tools only PREPARE the operation. The UI shows a confirmation modal',
  'and runs the actual signing + submission when the user clicks Confirm.',
  '',
  'Rules:',
  '  - Prefer calling tools over guessing. If a tool errors, report the error verbatim and stop.',
  '  - Always include Hedera token IDs (0.0.xxx) when relevant.',
  '  - Be concise — bullet points beat paragraphs.',
  "  - Never invent prices or volumes; if you don't have data, say so.",
].join('\n');

const agent = createAgent({
  model: llm,
  tools,
  systemPrompt: SYSTEM_PROMPT,
});

// Internal LangChain message names that should not be exposed as tool calls.
const INTERNAL_MSG_NAMES = new Set(['model', 'agent', 'tools', 'pre_model_hook', 'post_model_hook']);

/** Extract real tool names called this turn (filters LangChain noise). */
function extractToolCalls(messages) {
  const calls = new Set();
  for (const msg of messages) {
    if (msg?.name && !INTERNAL_MSG_NAMES.has(String(msg.name))) calls.add(String(msg.name));
    if (Array.isArray(msg?.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc?.name && !INTERNAL_MSG_NAMES.has(String(tc.name))) calls.add(String(tc.name));
      }
    }
  }
  return [...calls];
}

/** Log every tool message so we can see what each tool returned (incl. errors). */
function logToolMessages(messages) {
  for (const m of messages) {
    if (!m?.name || INTERNAL_MSG_NAMES.has(String(m.name))) continue;
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const short = content.length > 400 ? content.slice(0, 400) + '…' : content;
    console.log(`[tool ${m.name}]`, short);
  }
}

/** Try to JSON.parse the content of a ToolMessage and return the `raw` object. */
function parseToolRaw(m) {
  const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
  try {
    const parsed = JSON.parse(content);
    return parsed?.raw ?? parsed;
  } catch {
    return null;
  }
}

/** Walk tool messages and return any pendingConfirmation (buy) found. */
function extractPendingConfirmation(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.name !== 'sentx_buy_nft') continue;
    const raw = parseToolRaw(m);
    if (raw?.__sharklyPendingPurchase === true) {
      return {
        pendingId: raw.pendingId,
        token: raw.token,
        serial: String(raw.serial),
        price: raw.price,
        affiliateCommissionPct: raw.affiliateCommissionPct,
        totalCommissionPct: raw.totalCommissionPct,
        commissionDenominator: raw.commissionDenominator,
        totalCommissionHbar: raw.totalCommissionHbar,
        totalCostHbar: raw.totalCostHbar,
        buyerAccountId: raw.buyerAccountId,
        memo: raw.memo,
      };
    }
  }
  return null;
}

/** Same idea for sentx_list_nft. */
function extractPendingListConfirmation(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.name !== 'sentx_list_nft') continue;
    const raw = parseToolRaw(m);
    if (raw?.__sharklyPendingListing === true) {
      return {
        pendingListingId: raw.pendingListingId,
        token: raw.token,
        serial: String(raw.serial),
        price: raw.price,
        sellerAccountId: raw.sellerAccountId,
        memo: raw.memo,
        spender: raw.spender,
        skipOnChainApprove: raw.skipOnChainApprove,
      };
    }
  }
  return null;
}

/** Same idea for sentx_unlist_nft. */
function extractPendingUnlistConfirmation(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.name !== 'sentx_unlist_nft') continue;
    const raw = parseToolRaw(m);
    if (raw?.__sharklyPendingUnlisting === true) {
      return {
        pendingUnlistingId: raw.pendingUnlistingId,
        token: raw.token,
        serial: String(raw.serial),
        sellerAccountId: raw.sellerAccountId,
        skipOnChainApprove: raw.skipOnChainApprove,
      };
    }
  }
  return null;
}

// ─── Express ───────────────────────────────────────────────────────
const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: '2mb' }));
// Disable caching for the UI assets so the browser always pulls the latest app.js,
// styles.css and index.html during development. Otherwise users get stuck with a
// stale bundle from before features (modals, etc.) were added.
app.use(
  express.static(join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => {
      if (/\.(?:js|mjs|css|html)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }),
);

// GET /api/info — agent metadata for the UI
app.get('/api/info', (_req, res) => {
  res.json({
    name: 'Sharkly',
    tagline: 'Hunt the Hedera NFT market with AI',
    model: MODEL,
    llmProvider: llmProviderLabel,
    network: HEDERA_NETWORK,
    operatorAccountId: HEDERA_ACCOUNT_ID,
    affiliateEnabled: Boolean(SENTX_AFFILIATE_KEY),
    toolsCount: tools.length,
    sharklyToolsCount: sharklyToolNames.size,
    suggestions: [
      'Buy the cheapest Hotdog Hustle NFT (0.0.857979) for me',
      'What NFTs do I have in my wallet?',
      'List my NFT 0.0.857979 serial 5710 for 3 HBAR',
      'Unlist my NFT 0.0.857979 serial 5710',
      'What are the top 5 NFT collections on Hedera by 7d volume?',
    ],
  });
});

// POST /api/chat — { messages: [{role, content}, ...] } → { reply, toolCalls, pendingConfirmation? }
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const result = await agent.invoke({ messages });
    const allMessages = result?.messages ?? [];

    // Log every tool call result so we can debug silent tool failures
    logToolMessages(allMessages);

    const last = allMessages[allMessages.length - 1];
    const replyText =
      typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? result);

    const toolCalls = extractToolCalls(allMessages);
    const pendingConfirmation = extractPendingConfirmation(allMessages);
    const pendingListConfirmation = extractPendingListConfirmation(allMessages);
    const pendingUnlistConfirmation = extractPendingUnlistConfirmation(allMessages);

    res.json({
      reply: replyText,
      toolCalls,
      pendingConfirmation,
      pendingListConfirmation,
      pendingUnlistConfirmation,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Agent error:', msg);
    res.status(500).json({ error: msg });
  }
});

// GET /api/wallet — live balance of the operator account via Hedera mirror node
const MIRROR_NODE_HOSTS = {
  mainnet: 'https://mainnet-public.mirrornode.hedera.com',
  testnet: 'https://testnet.mirrornode.hedera.com',
  previewnet: 'https://previewnet.mirrornode.hedera.com',
};

app.get('/api/wallet', async (_req, res) => {
  const host = MIRROR_NODE_HOSTS[HEDERA_NETWORK] ?? MIRROR_NODE_HOSTS.mainnet;
  try {
    const r = await fetch(`${host}/api/v1/accounts/${HEDERA_ACCOUNT_ID}`, {
      headers: { accept: 'application/json' },
    });
    if (!r.ok) {
      return res.status(502).json({
        error: `Mirror node ${r.status}`,
        accountId: HEDERA_ACCOUNT_ID,
        network: HEDERA_NETWORK,
      });
    }
    const data = await r.json();
    const tinybar = data?.balance?.balance ?? 0;
    const hbar = tinybar / 100_000_000;
    res.json({
      accountId: HEDERA_ACCOUNT_ID,
      network: HEDERA_NETWORK,
      balanceTinybar: tinybar,
      balanceHbar: hbar,
      keyType: data?.key?._type ?? null,
      affiliateEnabled: Boolean(SENTX_AFFILIATE_KEY),
      hashscanUrl: `https://hashscan.io/${HEDERA_NETWORK}/account/${HEDERA_ACCOUNT_ID}`,
      timestamp: data?.balance?.timestamp ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: msg,
      accountId: HEDERA_ACCOUNT_ID,
      network: HEDERA_NETWORK,
    });
  }
});

// GET /api/history — recent NFT transactions for the operator account
//
// Reads on-chain history from the Hedera mirror node, filtered to NFT
// transfers involving HEDERA_ACCOUNT_ID. Recognises Sharkly purchases by
// the SentX memo. Stateless (nothing persisted server-side).
app.get('/api/history', async (req, res) => {
  const host = MIRROR_NODE_HOSTS[HEDERA_NETWORK] ?? MIRROR_NODE_HOSTS.mainnet;
  const limit = Math.min(Number(req.query.limit ?? 50), 100);
  try {
    // Get transactions involving our account
    const url = `${host}/api/v1/transactions?account.id=${HEDERA_ACCOUNT_ID}&order=desc&limit=${limit}&transactiontype=CRYPTOTRANSFER`;
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) {
      return res.status(502).json({ error: `Mirror node ${r.status}`, items: [] });
    }
    const data = await r.json();
    const items = [];
    for (const tx of data.transactions ?? []) {
      // Decode memo (base64-encoded by mirror node)
      let memo = '';
      try {
        memo = tx.memo_base64 ? Buffer.from(tx.memo_base64, 'base64').toString('utf8') : '';
      } catch {}

      // Only keep txs that actually moved NFTs
      const nftMoves = (tx.nft_transfers ?? []).filter(
        (n) => n.sender_account_id === HEDERA_ACCOUNT_ID || n.receiver_account_id === HEDERA_ACCOUNT_ID,
      );
      if (nftMoves.length === 0) continue;

      // Calculate net HBAR movement for our account (negative = paid out)
      let hbarDelta = 0;
      for (const t of tx.transfers ?? []) {
        if (t.account === HEDERA_ACCOUNT_ID) hbarDelta += t.amount;
      }
      const hbar = hbarDelta / 100_000_000;

      for (const nft of nftMoves) {
        const isBuy = nft.receiver_account_id === HEDERA_ACCOUNT_ID;
        const counterparty = isBuy ? nft.sender_account_id : nft.receiver_account_id;
        items.push({
          timestamp: tx.consensus_timestamp,
          dateISO: new Date(Number(tx.consensus_timestamp.split('.')[0]) * 1000).toISOString(),
          transactionId: tx.transaction_id,
          type: isBuy ? 'buy' : 'sell',
          token: nft.token_id,
          serial: nft.serial_number,
          counterparty,
          hbarAmount: Math.abs(hbar),
          memo,
          viaSharkly: /sharkly/i.test(memo) || /SentX Market \(API\)/i.test(memo),
          hashscanUrl: `https://hashscan.io/${HEDERA_NETWORK}/transaction/${encodeURIComponent(tx.transaction_id)}`,
        });
      }
    }
    res.json({
      accountId: HEDERA_ACCOUNT_ID,
      network: HEDERA_NETWORK,
      count: items.length,
      items,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg, items: [] });
  }
});

// POST /api/pending/:id — peek at a pending purchase (for UI rehydration)
app.get('/api/pending/:id', (req, res) => {
  const p = getPendingPurchase(req.params.id);
  if (!p) return res.status(404).json({ error: 'pending purchase not found or expired' });
  res.json({
    pendingId: p.id,
    token: p.token,
    serial: String(p.serial),
    price: p.price,
    affiliateCommission: p.affiliateCommission,
    totalCommission: p.totalCommission,
    buyerAccountId: p.buyerAccountId,
    memo: p.memo,
    expiresAt: p.expiresAt,
  });
});

/**
 * Check if the operator account has a given HTS token associated.
 * Uses mirror node (free, no HBAR spent).
 */
async function isTokenAssociated(tokenId) {
  const host = MIRROR_NODE_HOSTS[HEDERA_NETWORK] ?? MIRROR_NODE_HOSTS.mainnet;
  const url = `${host}/api/v1/accounts/${HEDERA_ACCOUNT_ID}/tokens?token.id=${encodeURIComponent(tokenId)}&limit=1`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) {
    // If we can't tell, fall back to "try the buy anyway and let Hedera reject if needed".
    console.warn(`[associate-check] mirror node ${r.status}, skipping pre-check`);
    return true;
  }
  const data = await r.json();
  return Array.isArray(data.tokens) && data.tokens.length > 0;
}

/** Associate `tokenId` to the operator account. Costs ~$0.05 in HBAR. */
async function associateToken(tokenId) {
  const tx = new TokenAssociateTransaction()
    .setAccountId(HEDERA_ACCOUNT_ID)
    .setTokenIds([tokenId])
    .freezeWith(client);
  const signed = await tx.sign(operatorKey);
  const submitted = await signed.execute(client);
  const receipt = await submitted.getReceipt(client);
  return {
    transactionId: submitted.transactionId.toString(),
    status: receipt.status?.toString?.() ?? String(receipt.status),
  };
}

// POST /api/execute-purchase — { pendingId } → associate (if needed) → signs + submits → confirms with SentX
app.post('/api/execute-purchase', async (req, res) => {
  const { pendingId } = req.body ?? {};
  if (!pendingId || typeof pendingId !== 'string') {
    return res.status(400).json({ error: 'pendingId is required' });
  }

  const pending = consumePendingPurchase(pendingId);
  if (!pending) {
    return res.status(404).json({ error: 'pending purchase not found or expired' });
  }

  if (pending.isEvmNft) {
    return res.status(400).json({ error: 'EVM-native NFTs are not supported in this MVP.' });
  }

  if (String(pending.buyerAccountId) !== String(HEDERA_ACCOUNT_ID)) {
    return res.status(400).json({
      error: `Operator mismatch: pending purchase was prepared for ${pending.buyerAccountId} but the server operator is ${HEDERA_ACCOUNT_ID}.`,
    });
  }

  try {
    // 1. Make sure the operator has the NFT collection associated. Hedera
    //    rejects transfers to accounts that have not opted-in (HTS rule).
    let associateInfo = null;
    const alreadyAssociated = await isTokenAssociated(pending.token);
    console.log(`[execute-purchase] token ${pending.token} associated=${alreadyAssociated}`);
    if (!alreadyAssociated) {
      console.log(`[execute-purchase] associating token ${pending.token} to ${HEDERA_ACCOUNT_ID}…`);
      associateInfo = await associateToken(pending.token);
      console.log(`[execute-purchase] associate tx ${associateInfo.transactionId} → ${associateInfo.status}`);
      if (associateInfo.status !== 'SUCCESS' && associateInfo.status !== '22') {
        return res.status(500).json({
          error: `Token association failed: ${associateInfo.status}`,
          associate: associateInfo,
        });
      }
    }

    // 2. Deserialize SentX-issued unsigned transaction
    const tx = Transaction.fromBytes(pending.unsignedTxBytes);

    // 3. Sign with operator + submit to Hedera
    const submitted = await tx.execute(client);
    const transactionId = submitted.transactionId.toString();

    // 4. Wait for consensus before telling SentX
    await submitted.getReceipt(client);

    // 5. Confirm the sale with SentX
    const sentxApiKey = SENTX_AFFILIATE_KEY || SENTX_API_KEY;
    const url = new URL('https://api.sentx.io/v1/affiliate/market/buynftres');
    url.searchParams.set('apikey', sentxApiKey);
    const confResponse = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        saleVerificationCode: pending.saleVerificationCode,
        transactionId,
      }),
    });

    let confirmation = null;
    if (confResponse.ok) {
      confirmation = await confResponse.json().catch(() => null);
    }

    const hashscanUrl = `https://hashscan.io/${HEDERA_NETWORK}/transaction/${encodeURIComponent(transactionId)}`;
    const associateHashscanUrl = associateInfo
      ? `https://hashscan.io/${HEDERA_NETWORK}/transaction/${encodeURIComponent(associateInfo.transactionId)}`
      : null;

    res.json({
      success: true,
      transactionId,
      hashscanUrl,
      associate: associateInfo
        ? { ...associateInfo, hashscanUrl: associateHashscanUrl }
        : null,
      sentxConfirmation: confirmation,
      sentxConfirmationStatus: confResponse.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('execute-purchase error:', msg);
    res.status(500).json({ error: msg });
  }
});

// POST /api/execute-listing — { pendingListingId } → signs approval + confirms with SentX
app.post('/api/execute-listing', async (req, res) => {
  const { pendingListingId } = req.body ?? {};
  if (!pendingListingId || typeof pendingListingId !== 'string') {
    return res.status(400).json({ error: 'pendingListingId is required' });
  }

  const pending = consumePendingListing(pendingListingId);
  if (!pending) {
    return res.status(404).json({ error: 'pending listing not found or expired' });
  }
  if (String(pending.sellerAccountId) !== String(HEDERA_ACCOUNT_ID)) {
    return res.status(400).json({
      error: `Operator mismatch: pending listing was prepared for ${pending.sellerAccountId} but the server operator is ${HEDERA_ACCOUNT_ID}.`,
    });
  }

  try {
    let transactionId;
    if (pending.skipOnChainApprove) {
      // SentX told us no on-chain approval is needed — use the literal "skip".
      transactionId = 'skip';
      console.log(`[execute-listing] skipOnChainApprove=true, skipping wallet signature`);
    } else {
      // 1. Sign + submit the approval transaction
      const tx = Transaction.fromBytes(pending.unsignedTxBytes);
      const submitted = await tx.execute(client);
      transactionId = submitted.transactionId.toString();
      await submitted.getReceipt(client);
      console.log(`[execute-listing] approval submitted: ${transactionId}`);
    }

    // 2. Confirm the listing with SentX
    const sentxApiKey = SENTX_AFFILIATE_KEY || SENTX_API_KEY;
    const url = new URL('https://api.sentx.io/v1/affiliate/market/listnftres');
    url.searchParams.set('apikey', sentxApiKey);
    const confResponse = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        saleVerificationCode: pending.saleVerificationCode,
        transactionId,
        user_address: pending.sellerAccountId,
      }),
    });

    let confirmation = null;
    if (confResponse.ok) {
      confirmation = await confResponse.json().catch(() => null);
    }

    const hashscanUrl =
      transactionId === 'skip'
        ? null
        : `https://hashscan.io/${HEDERA_NETWORK}/transaction/${encodeURIComponent(transactionId)}`;

    res.json({
      success: true,
      transactionId,
      hashscanUrl,
      sentxConfirmation: confirmation,
      sentxConfirmationStatus: confResponse.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('execute-listing error:', msg);
    res.status(500).json({ error: msg });
  }
});

// POST /api/execute-unlisting — { pendingUnlistingId } → signs + submits + confirms
app.post('/api/execute-unlisting', async (req, res) => {
  const { pendingUnlistingId } = req.body ?? {};
  if (!pendingUnlistingId || typeof pendingUnlistingId !== 'string') {
    return res.status(400).json({ error: 'pendingUnlistingId is required' });
  }
  const pending = consumePendingUnlisting(pendingUnlistingId);
  if (!pending) {
    return res.status(404).json({ error: 'pending unlisting not found or expired' });
  }
  if (String(pending.sellerAccountId) !== String(HEDERA_ACCOUNT_ID)) {
    return res.status(400).json({
      error: `Operator mismatch: ${pending.sellerAccountId} vs ${HEDERA_ACCOUNT_ID}.`,
    });
  }

  try {
    let transactionId;
    if (pending.skipOnChainApprove) {
      transactionId = 'skip';
      console.log(`[execute-unlisting] skipOnChainApprove=true`);
    } else {
      const tx = Transaction.fromBytes(pending.unsignedTxBytes);
      const submitted = await tx.execute(client);
      transactionId = submitted.transactionId.toString();
      await submitted.getReceipt(client);
      console.log(`[execute-unlisting] unlisting submitted: ${transactionId}`);
    }

    const sentxApiKey = SENTX_AFFILIATE_KEY || SENTX_API_KEY;
    const url = new URL('https://api.sentx.io/v1/affiliate/market/unlistnftres');
    url.searchParams.set('apikey', sentxApiKey);
    const confResponse = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        saleVerificationCode: pending.saleVerificationCode,
        transactionId,
        user_address: pending.sellerAccountId,
      }),
    });

    let confirmation = null;
    if (confResponse.ok) {
      confirmation = await confResponse.json().catch(() => null);
    }

    const hashscanUrl =
      transactionId === 'skip'
        ? null
        : `https://hashscan.io/${HEDERA_NETWORK}/transaction/${encodeURIComponent(transactionId)}`;

    res.json({
      success: true,
      transactionId,
      hashscanUrl,
      sentxConfirmation: confirmation,
      sentxConfirmationStatus: confResponse.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('execute-unlisting error:', msg);
    res.status(500).json({ error: msg });
  }
});

// Export the Express app for Vercel serverless and local listen
export default app;

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  app.listen(PORT, () => {
    console.log('');
    console.log('+================================================================+');
    console.log('|  S H A R K L Y    is hunting                                   |');
    console.log('+================================================================+');
    console.log(`|  Web UI:    http://localhost:${String(PORT).padEnd(34)}|`);
    console.log(`|  LLM:       ${llmProviderLabel.padEnd(51)}|`);
    console.log(`|  Network:   ${HEDERA_NETWORK.padEnd(51)}|`);
    console.log(`|  Operator:  ${HEDERA_ACCOUNT_ID.padEnd(51)}|`);
    const buyEnabled = SENTX_AFFILIATE_KEY && HEDERA_AFFILIATE_ACCOUNT_ID && HEDERA_AFFILIATE_PRIVATE_KEY;
    console.log(`|  Affiliate: ${(buyEnabled ? `enabled (signing acct ${HEDERA_AFFILIATE_ACCOUNT_ID})` : 'disabled (read-only)').padEnd(51)}|`);
    console.log(`|  Tools:     ${String(tools.length).padEnd(51)}|`);
    console.log('+================================================================+');
    console.log('');
  });
}
