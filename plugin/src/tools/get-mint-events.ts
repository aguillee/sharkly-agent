import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_MINT_EVENTS = "sentx_get_mint_events";

const params = (_c: Context = {}) =>
  z.object({
    hideSoldOut: z.enum(["0", "1"]).optional(),
    tokenAddress: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    isForeverMint: z.boolean().optional(),
  });

const prompt = (_c: Context = {}) => `
Active mint events on SentX launchpad. Optionally hide sold-out, filter by token, date range, foreverMint.
`;

type P = z.infer<ReturnType<typeof params>>;

export class SentxGetMintEventsTool extends BaseTool {
  method = SENTX_GET_MINT_EVENTS;
  name = "SentX Get Mint Events";
  description: string;
  parameters: ReturnType<typeof params>;
  constructor(_c: Context, private sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }
  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(p: P) { return this.sentx.getMintEvents(p); }
  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getMintEvents"]>>;
    const events = r.mintEvents ?? [];
    return { raw: r, humanMessage: `${events.length} active mint event(s).` };
  };
  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(err: unknown) {
    const msg = `sentx_get_mint_events failed: ${err instanceof Error ? err.message : String(err)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getMintEventsTool =
  (sentx: SentxClient) => (c: Context): BaseTool => new SentxGetMintEventsTool(c, sentx);
