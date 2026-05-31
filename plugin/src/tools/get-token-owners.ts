import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_TOKEN_OWNERS = "sentx_get_token_owners";

const params = (_c: Context = {}) =>
  z.object({
    token: z.string().describe("Collection token ID."),
    amount: z.number().int().min(1).max(500).default(100),
  });

const prompt = (_c: Context = {}) => `
Owners of a collection, sorted by how many NFTs each holds. Useful for whale detection.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGetTokenOwnersTool extends BaseTool {
  method = SENTX_GET_TOKEN_OWNERS;
  name = "SentX Get Token Owners";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.getTokenOwners(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getTokenOwners"]>>;
    return {
      raw: r,
      humanMessage: `${r.ownerCount} unique owner(s), ${r.nftCount} total NFTs (returned ${r.amountReturned}).`,
    };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_token_owners failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getTokenOwnersTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetTokenOwnersTool(c, sentx);
