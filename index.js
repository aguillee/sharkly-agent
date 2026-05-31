// index.js — Sharkly CLI (terminal REPL).
//
// Read-only — no Hedera account needed. Uses Vercel AI Gateway for the LLM.
//
// Run:
//   cp .env.example .env   # fill in SENTX_API_KEY + AI_GATEWAY_API_KEY
//   npm install
//   npm run cli

import dotenv from 'dotenv';
dotenv.config({ override: true });

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { Client, PrivateKey } from '@hiero-ledger/sdk';
import { AgentMode } from '@hashgraph/hedera-agent-kit';
import { HederaLangchainToolkit } from '@hashgraph/hedera-agent-kit-langchain';
import { createAgent } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';

import { createSharklyPlugin } from 'hak-sharkly-plugin';

// ─── Env validation ─────────────────────────────────────────────────
function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`X Missing env var ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

const SENTX_API_KEY = required('SENTX_API_KEY');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
if (!ANTHROPIC_API_KEY && !AI_GATEWAY_API_KEY) {
  console.error('X No LLM key found. Set ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY.');
  process.exit(1);
}
const RAW_MODEL = process.env.LLM_MODEL ?? 'claude-haiku-4-5';

// ─── Hedera client — DUMMY operator, never signs anything ───────────
const dummyAccountId = '0.0.2';
const client = Client.forTestnet().setOperator(dummyAccountId, PrivateKey.generateED25519());

// ─── Toolkit ────────────────────────────────────────────────────────
const sharklyPlugin = createSharklyPlugin({
  apiKey: SENTX_API_KEY,
  project: process.env.SENTX_PROJECT,
});

const toolkit = new HederaLangchainToolkit({
  client,
  configuration: {
    tools: [],
    plugins: [sharklyPlugin],
    context: { mode: AgentMode.AUTONOMOUS, accountId: dummyAccountId },
  },
});

const tools = toolkit.getTools();

// ─── Agent ──────────────────────────────────────────────────────────
let llm;
let MODEL;
if (ANTHROPIC_API_KEY) {
  MODEL = RAW_MODEL.replace(/^anthropic\//, '');
  llm = new ChatAnthropic({ apiKey: ANTHROPIC_API_KEY, model: MODEL, temperature: 0 });
} else {
  MODEL = RAW_MODEL.includes('/') ? RAW_MODEL : `anthropic/${RAW_MODEL}`;
  llm = new ChatOpenAI({
    apiKey: AI_GATEWAY_API_KEY,
    model: MODEL,
    temperature: 0,
    configuration: { baseURL: 'https://ai-gateway.vercel.sh/v1' },
  });
}

const agent = createAgent({
  model: llm,
  tools,
  systemPrompt: [
    'You are Sharkly — a Hedera AI agent that hunts the SentX NFT marketplace.',
    'You have READ-ONLY access: listings, floor, recent activity, top collections, time-series stats.',
    'You cannot buy, list or transfer NFTs.',
    '',
    'Rules:',
    '  - Prefer calling tools over guessing. If a tool errors, report the error verbatim and stop.',
    '  - Always include Hedera token IDs (0.0.xxx) when relevant.',
    '  - Be concise. Bullet points beat paragraphs.',
    "  - Never invent prices or volumes; if you don't have data, say so.",
  ].join('\n'),
});

// ─── Banner ─────────────────────────────────────────────────────────
function line(text) {
  const inner = ` ${text}`.padEnd(64);
  return `|${inner.slice(0, 64)}|`;
}

function banner() {
  console.log('');
  console.log('+================================================================+');
  console.log(line('S H A R K L Y'));
  console.log(line('Hunt the Hedera NFT market with AI'));
  console.log('+================================================================+');
  console.log(line(`Model: ${MODEL}`));
  console.log(line(`Tools: ${tools.length}`));
  console.log('+================================================================+');
  console.log('');
  console.log('Try things like:');
  console.log('  - "What are the top 5 NFT collections on Hedera by 7d volume?"');
  console.log('  - "What\'s the floor of Dead Pixels Ghost Club today?"');
  console.log('  - "Show me the last 10 sales of token 0.0.878200"');
  console.log('');
  console.log('Type "exit" or hit Ctrl+C to quit.');
  console.log('');
}

// ─── Chat loop ──────────────────────────────────────────────────────
async function chat() {
  banner();
  const rl = readline.createInterface({ input, output });
  const history = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const userInput = (await rl.question('you> ')).trim();
    if (!userInput) continue;
    if (['exit', 'quit', ':q'].includes(userInput.toLowerCase())) break;

    history.push({ role: 'user', content: userInput });
    try {
      const res = await agent.invoke({ messages: history });
      const last = res.messages[res.messages.length - 1];
      const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content, null, 2);
      history.push({ role: 'assistant', content: text });
      console.log(`\nSharkly> ${text}\n`);
    } catch (err) {
      console.error(`\nX Agent error: ${err?.message ?? err}\n`);
    }
  }

  rl.close();
  client.close();
  console.log('\nBye.');
}

chat().catch((err) => {
  console.error(err);
  client.close();
  process.exit(1);
});
