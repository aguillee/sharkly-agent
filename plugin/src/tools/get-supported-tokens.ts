import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_SUPPORTED_TOKENS = "sentx_get_supported_tokens";

const params = (_c: Context = {}) => z.object({});
const prompt = (_c: Context = {}) => `
Get the full list of NFT collections supported by SentX. No parameters.
`;

export class SentxGetSupportedTokensTool extends BaseTool {
  method = SENTX_GET_SUPPORTED_TOKENS;
  name = "SentX Get Supported Tokens";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction() { return this.sentx.getSupportedTokens(); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getSupportedTokens"]>>;
    return { raw: r, humanMessage: `${r.supportedTokenList?.length ?? 0} supported collection(s).` };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_supported_tokens failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getSupportedTokensTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetSupportedTokensTool(c, sentx);
