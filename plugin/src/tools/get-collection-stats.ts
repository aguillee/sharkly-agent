import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_COLLECTION_STATS = "sentx_get_collection_stats";

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

const getCollectionStatsParameters = (_context: Context = {}) =>
  z.object({
    token: z
      .string()
      .optional()
      .describe("Hedera token ID of a single collection. Leave blank for cross-collection stats."),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .default(daysAgoISO(30))
      .describe("Start date in YYYY-MM-DD. Defaults to 30 days ago."),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .default(todayISO())
      .describe("End date in YYYY-MM-DD. Defaults to today."),
    page: z.number().int().min(1).default(1).describe("Page number."),
    limit: z.number().int().min(1).max(500).default(100).describe("Records per page (max 500)."),
  });

const getCollectionStatsPrompt = (_context: Context = {}) => `
Get time-series market statistics for an NFT collection on SentX.

Returns daily/hourly rows with volume, floor, avgSale, sales count, listings, etc.
Useful for answering "how has the floor of X moved this month?" or
"what's the trading volume trend?".

If \`token\` is omitted, returns aggregated rows across all supported collections.
`;

type Params = z.infer<ReturnType<typeof getCollectionStatsParameters>>;

export class SentxGetCollectionStatsTool extends BaseTool {
  method = SENTX_GET_COLLECTION_STATS;
  name = "SentX Get Collection Stats";
  description: string;
  parameters: ReturnType<typeof getCollectionStatsParameters>;

  private readonly sentx: SentxClient;

  constructor(context: Context, sentx: SentxClient) {
    super();
    this.description = getCollectionStatsPrompt(context);
    this.parameters = getCollectionStatsParameters(context);
    this.sentx = sentx;
  }

  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }

  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(params: Params) {
    return this.sentx.getTokenStats(params);
  }

  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getTokenStats"]>>;
    const rows = r.data ?? [];
    if (rows.length === 0) {
      return {
        raw: r,
        humanMessage: `No stats rows for the range ${r.dateFrom} → ${r.dateTo}.`,
      };
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    const totalVol = rows.reduce((acc, x) => acc + (x.volume ?? 0), 0);
    const totalSales = rows.reduce((acc, x) => acc + (x.sales ?? 0), 0);
    return {
      raw: r,
      humanMessage:
        `Stats ${r.dateFrom} → ${r.dateTo} (${rows.length} rows, total ${r.totalRecords}):\n` +
        `  • Total volume: ${totalVol} HBAR\n` +
        `  • Total sales: ${totalSales}\n` +
        `  • First row: ${first.datetime} floor=${first.floor} vol=${first.volume}\n` +
        `  • Last row:  ${last.datetime} floor=${last.floor} vol=${last.volume}`,
    };
  };

  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(error: unknown) {
    const msg = `sentx_get_collection_stats failed: ${error instanceof Error ? error.message : String(error)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getCollectionStatsTool =
  (sentx: SentxClient) =>
  (context: Context): BaseTool =>
    new SentxGetCollectionStatsTool(context, sentx);
