import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_LAUNCHPAD_ACTIVITY = "sentx_get_launchpad_activity";

const params = (_c: Context = {}) =>
  z.object({
    f: z.string().optional().describe("Friendly URL of a mint event."),
    token: z.string().optional().describe("Token address of a collection."),
    limit: z.number().int().min(1).max(500).default(50),
    page: z.number().int().min(1).max(10).default(1),
  });

const prompt = (_c: Context = {}) => `
Latest SentX launchpad mint activity. Filter by mint event friendly URL (f) or token address.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGetLaunchpadActivityTool extends BaseTool {
  method = SENTX_GET_LAUNCHPAD_ACTIVITY;
  name = "SentX Get Launchpad Activity";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.getLaunchpadActivity(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getLaunchpadActivity"]>>;
    const items = (r.response as unknown[] | undefined) ?? [];
    return { raw: r, humanMessage: `${items.length} launchpad event(s).` };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_launchpad_activity failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getLaunchpadActivityTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetLaunchpadActivityTool(c, sentx);
