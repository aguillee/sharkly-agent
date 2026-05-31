import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_ACTIVITY = "sentx_get_market_activity";

const getActivityParameters = (_context: Context = {}) =>
  z.object({
    token: z
      .string()
      .optional()
      .describe("Hedera token ID of the collection to filter by. Leave blank for marketwide activity."),
    serial: z
      .union([z.string(), z.number()])
      .optional()
      .describe("Specific serial ID to filter by (requires `token`)."),
    activityFilter: z
      .enum(["Sales", "Listings", "All"])
      .optional()
      .describe("Restrict to a single activity type. SentX only supports these three values."),
    amount: z.number().int().min(1).max(200).default(25).describe("Number of records to return."),
    page: z.number().int().min(1).max(10).default(1).describe("Page number (max 10)."),
    hbarMarketOnly: z
      .boolean()
      .optional()
      .describe("True = only HBAR-denominated sales. False/omit = all payment tokens."),
  });

const getActivityPrompt = (_context: Context = {}) => `
Get recent market activity (sales, listings, mints, offers, transfers) on SentX.

Useful to answer questions like:
  - "What were the last 10 Dead Pixels sales?"
  - "Has anyone listed Sanctuary Dragon #42?"
  - "Show me the most recent mints across all collections."

Returns an array of activity events with collection, NFT, price, buyer, seller and date.
`;

type Params = z.infer<ReturnType<typeof getActivityParameters>>;

export class SentxGetActivityTool extends BaseTool {
  method = SENTX_GET_ACTIVITY;
  name = "SentX Get Market Activity";
  description: string;
  parameters: ReturnType<typeof getActivityParameters>;

  private readonly sentx: SentxClient;

  constructor(context: Context, sentx: SentxClient) {
    super();
    this.description = getActivityPrompt(context);
    this.parameters = getActivityParameters(context);
    this.sentx = sentx;
  }

  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }

  async normalizeParams(params: Params) {
    if (params.serial && !params.token) {
      throw new Error("`serial` requires `token`");
    }
    return params;
  }

  async coreAction(params: Params) {
    return this.sentx.getActivity({
      ...params,
      hbarMarketOnly: params.hbarMarketOnly === true ? 1 : params.hbarMarketOnly === false ? 0 : undefined,
    });
  }

  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getActivity"]>>;
    const items = r.marketActivity ?? [];
    if (items.length === 0) {
      return { raw: r, humanMessage: "No market activity found for the given filters." };
    }
    const lines = items
      .slice(0, 10)
      .map((a) => {
        const price = a.salePrice ? `${a.salePrice} ${a.salePriceSymbol || "HBAR"}` : "—";
        const who = a.buyerAddress ? `buyer ${a.buyerAddress}` : `seller ${a.sellerAddress ?? "?"}`;
        const when = new Date(a.saleDate).toISOString().slice(0, 10);
        return `  • [${when}] ${a.saletype} — ${a.nftName} (${a.collectionName}) — ${price} — ${who}`;
      })
      .join("\n");
    const more = items.length > 10 ? `\n  …and ${items.length - 10} more.` : "";
    return { raw: r, humanMessage: `${items.length} activity event(s):\n${lines}${more}` };
  };

  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(error: unknown) {
    const msg = `sentx_get_market_activity failed: ${error instanceof Error ? error.message : String(error)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getActivityTool =
  (sentx: SentxClient) =>
  (context: Context): BaseTool =>
    new SentxGetActivityTool(context, sentx);
