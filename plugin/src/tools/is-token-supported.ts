import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_IS_TOKEN_SUPPORTED = "sentx_is_token_supported";

const params = (_c: Context = {}) =>
  z.object({
    token: z
      .string()
      .describe('Single token ID or comma-separated list, e.g. "0.0.878200,0.0.1234567".'),
  });

const prompt = (_c: Context = {}) => `
Check if one or more NFT collections are supported by SentX. Pass single token or comma-separated.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxIsTokenSupportedTool extends BaseTool {
  method = SENTX_IS_TOKEN_SUPPORTED;
  name = "SentX Is Token Supported";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.isTokenSupported(p); }
  outputParser = (raw: unknown) => {
    return { raw, humanMessage: `Support check result: ${JSON.stringify(raw)}` };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_is_token_supported failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const isTokenSupportedTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxIsTokenSupportedTool(c, sentx);
