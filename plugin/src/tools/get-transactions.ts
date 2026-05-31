import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_TRANSACTIONS = "sentx_get_transactions";

const params = (_c: Context = {}) =>
  z.object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    token: z.string().optional(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(500).default(100),
  });

const prompt = (_c: Context = {}) => `
Get individual SentX market transactions in a date range, paginated. Optionally filter by collection token.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGetTransactionsTool extends BaseTool {
  method = SENTX_GET_TRANSACTIONS;
  name = "SentX Get Transactions";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.getTransactions(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getTransactions"]>>;
    return {
      raw: r,
      humanMessage: `${r.data?.length ?? 0} tx of ${r.totalRecords} total ${r.dateFrom} → ${r.dateTo}.`,
    };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_transactions failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getTransactionsTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetTransactionsTool(c, sentx);
