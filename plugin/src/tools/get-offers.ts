import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_OFFERS = "sentx_get_offers";

const params = (_c: Context = {}) =>
  z.object({
    token: z.string().optional(),
    filterUserAccount: z.string().optional(),
    statusFilterTypeId: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .optional()
      .describe("0=pending, 1=submitted, 2=accepted."),
    serialId: z.number().int().optional(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
  });

const prompt = (_c: Context = {}) => `
Get marketplace offers on SentX. Filter by collection, user account, status, serial ID.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGetOffersTool extends BaseTool {
  method = SENTX_GET_OFFERS;
  name = "SentX Get Offers";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.getOffers(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getOffers"]>>;
    const offers = (r.response as unknown[] | undefined) ?? [];
    if (!offers.length) return { raw: r, humanMessage: "No offers found." };
    return { raw: r, humanMessage: `${offers.length} offer(s) returned.` };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_offers failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getOffersTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetOffersTool(c, sentx);
