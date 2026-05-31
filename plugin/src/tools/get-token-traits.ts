import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_TOKEN_TRAITS = "sentx_get_token_traits";

const params = (_c: Context = {}) =>
  z.object({
    token: z.string().describe("Collection token ID."),
  });

const prompt = (_c: Context = {}) => `
All traits and values for a collection — includes rarity % and per-trait floor prices.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGetTokenTraitsTool extends BaseTool {
  method = SENTX_GET_TOKEN_TRAITS;
  name = "SentX Get Token Traits";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.getTokenTraits(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getTokenTraits"]>>;
    const keys = Object.keys(r.traits ?? {});
    return {
      raw: r,
      humanMessage: `${keys.length} trait categories for ${r.token}: ${keys.join(", ") || "(none)"}`,
    };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_token_traits failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getTokenTraitsTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetTokenTraitsTool(c, sentx);
