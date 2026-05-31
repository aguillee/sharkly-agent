import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GENERATE_PRNG = "sentx_generate_prng";

const params = (_c: Context = {}) =>
  z.object({
    min: z.number().int().optional().describe("Inclusive lower bound."),
    max: z.number().int().optional().describe("Inclusive upper bound. max-min+1 ≤ 2^32."),
    count: z.number().int().min(1).max(10).default(1),
  });

const prompt = (_c: Context = {}) => `
Generate a provably-fair random integer backed by a real Hedera PrngTransaction.
Returns the values + HashScan URL of the on-chain transaction. Useful for raffles,
drops, fair selection.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGeneratePrngTool extends BaseTool {
  method = SENTX_GENERATE_PRNG;
  name = "SentX Generate PRNG";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.generatePrng(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["generatePrng"]>>;
    return {
      raw: r,
      humanMessage:
        `🎲 PRNG values: ${(r.values || []).join(", ")}\n` +
        `Hedera tx: ${r.hederaTransactionId}\n` +
        `HashScan: ${r.hashScanUrl}`,
    };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_generate_prng failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const generatePrngTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGeneratePrngTool(c, sentx);
