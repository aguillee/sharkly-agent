import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_AGGREGATED_STATS = "sentx_get_aggregated_stats";

const params = (_c: Context = {}) =>
  z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  });

const prompt = (_c: Context = {}) => `
Total HBAR volume traded on SentX within a date range (marketwide aggregate).
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGetAggregatedStatsTool extends BaseTool {
  method = SENTX_GET_AGGREGATED_STATS;
  name = "SentX Get Aggregated Stats";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.getAggregatedStats(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getAggregatedStats"]>>;
    return {
      raw: r,
      humanMessage: `Total volume ${r.dateFrom} → ${r.dateTo}: ${r.totalVolume} ${r.token || "HBAR"}.`,
    };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_aggregated_stats failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getAggregatedStatsTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetAggregatedStatsTool(c, sentx);
