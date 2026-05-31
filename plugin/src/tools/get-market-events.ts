import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_MARKET_EVENTS = "sentx_get_market_events";

const params = (_c: Context = {}) =>
  z.object({
    token: z.string().optional().describe("Hedera token ID to filter."),
    serialId: z.number().int().optional().describe("Specific serial (requires token)."),
    since: z.string().optional().describe("ISO 8601 timestamp; only events after this."),
    eventType: z
      .enum(["listed", "price_changed", "sold", "delisted"])
      .optional()
      .describe("Event type filter. Note: SentX uses snake_case (price_changed) not camelCase."),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
  });

const prompt = (_c: Context = {}) => `
Unified SentX marketplace event feed: listings, sales, price changes, delistings, accepted offers.
Single source of truth for any marketplace state change. Filter by token, serialId, since (ISO), eventType.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGetMarketEventsTool extends BaseTool {
  method = SENTX_GET_MARKET_EVENTS;
  name = "SentX Get Market Events";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.getMarketEvents(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getMarketEvents"]>>;
    const evs = r.events ?? [];
    if (!evs.length) return { raw: r, humanMessage: "No market events." };
    return { raw: r, humanMessage: `${evs.length} event(s) returned (page ${r.page}).` };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_market_events failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getMarketEventsTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetMarketEventsTool(c, sentx);
