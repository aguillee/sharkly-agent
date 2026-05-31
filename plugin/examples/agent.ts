/**
 * 🦈 Sharkly demo agent — runnable with `npm run demo "<your question>"`.
 *
 * Wires up the Sharkly plugin into a LangChain tool-calling agent powered by
 * OpenAI. The Hedera Agent Kit needs a Client to initialise; for this read-only
 * plugin no transactions are signed.
 */

import "dotenv/config";
import { Client, PrivateKey } from "@hiero-ledger/sdk";
import { AgentMode } from "@hashgraph/hedera-agent-kit";
import { HederaLangchainToolkit } from "@hashgraph/hedera-agent-kit-langchain";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";

import { createSharklyPlugin } from "../src/index.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const question =
    process.argv.slice(2).join(" ") ||
    "What are the top 5 NFT collections on Hedera right now by 7d volume?";

  const network = process.env.HEDERA_NETWORK ?? "mainnet";
  const accountId = required("HEDERA_ACCOUNT_ID");
  const privateKey = required("HEDERA_PRIVATE_KEY");

  const client =
    network === "mainnet"
      ? Client.forMainnet()
      : network === "testnet"
        ? Client.forTestnet()
        : Client.forPreviewnet();

  // Auto-detect ED25519 vs ECDSA from DER prefix.
  const key = privateKey.startsWith("0x")
    ? PrivateKey.fromStringECDSA(privateKey)
    : PrivateKey.fromString(privateKey);
  client.setOperator(accountId, key);

  const sharklyPlugin = createSharklyPlugin({
    apiKey: required("SENTX_API_KEY"),
    project: process.env.SENTX_PROJECT,
  });

  const toolkit = new HederaLangchainToolkit({
    client,
    configuration: {
      plugins: [sharklyPlugin],
      context: { mode: AgentMode.AUTONOMOUS },
    },
  });

  const tools = toolkit.getTools();

  const llm = new ChatOpenAI({
    apiKey: required("OPENAI_API_KEY"),
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      [
        "You are 🦈 Sharkly — a Hedera AI agent that hunts the SentX NFT marketplace.",
        "You have read-only access to SentX (listings, floor, recent activity, top collections, time-series stats).",
        "Answer questions with concrete numbers. Always include token IDs (0.0.xxx) when relevant.",
        "Prefer calling tools over guessing. If a tool errors, explain the error and stop — do not hallucinate.",
      ].join(" "),
    ],
    ["human", "{input}"],
    ["placeholder", "{agent_scratchpad}"],
  ]);

  const agent = createToolCallingAgent({ llm, tools, prompt });
  const executor = new AgentExecutor({ agent, tools, verbose: false });

  console.log(`\n🧑 ${question}\n`);
  const res = await executor.invoke({ input: question });
  console.log(`\n🦈 ${res?.output ?? res}\n`);

  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
