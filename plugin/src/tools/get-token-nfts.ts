import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_TOKEN_NFTS = "sentx_get_token_nfts";

const params = (_c: Context = {}) =>
  z.object({
    token: z.string().describe("Collection token ID."),
    sortBy: z
      .enum(["serial", "rarity", "listingDate"])
      .default("serial")
      .describe("Field to sort by."),
    sortDirection: z.enum(["ASC", "DESC"]).default("ASC"),
    limit: z.number().int().min(1).max(200).default(100),
    page: z.number().int().min(1).default(1),
  });

const prompt = (_c: Context = {}) => `
Paginated list of every NFT in a collection: name, image, rarity, serial, metadata.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGetTokenNftsTool extends BaseTool {
  method = SENTX_GET_TOKEN_NFTS;
  name = "SentX Get Token NFTs";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.getTokenNfts(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getTokenNfts"]>>;
    return {
      raw: r,
      humanMessage: `${r.nfts?.length ?? 0} of ${r.total} NFT(s) in ${r.token}, page ${r.page}.`,
    };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_token_nfts failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getTokenNftsTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetTokenNftsTool(c, sentx);
