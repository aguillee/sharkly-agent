import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_USER_VOLUME = "sentx_get_user_volume";

const params = (_c: Context = {}) =>
  z.object({
    token: z.string().optional().describe("Filter by collection token (optional)."),
    page: z.union([z.string(), z.number()]).default("1"),
    amount: z.number().int().min(1).max(500).default(100),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  });

const prompt = (_c: Context = {}) => `
Top users on SentX by trading volume. Filter by collection or marketwide. Date range optional.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGetUserVolumeTool extends BaseTool {
  method = SENTX_GET_USER_VOLUME;
  name = "SentX Get User Volume Rankings";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.getUserVolume(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getUserVolume"]>>;
    const users = (r.response as unknown[] | undefined) ?? [];
    return { raw: r, humanMessage: `${users.length} user(s) returned in the volume ranking.` };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_user_volume failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getUserVolumeTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetUserVolumeTool(c, sentx);
