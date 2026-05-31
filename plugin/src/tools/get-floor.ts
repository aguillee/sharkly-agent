import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_FLOOR = "sentx_get_floor";

const getFloorParameters = (_context: Context = {}) =>
  z.object({
    token: z
      .string()
      .describe('Hedera token ID of the NFT collection, e.g. "0.0.878200" for Dead Pixels Ghost Club.'),
    trait_type: z
      .string()
      .optional()
      .describe('Optional. Trait name for trait-floor lookup, e.g. "Background". Requires `value`.'),
    value: z
      .string()
      .optional()
      .describe('Optional. Trait value for trait-floor lookup, e.g. "Blue". Requires `trait_type`.'),
    traits: z
      .string()
      .optional()
      .describe(
        'Optional. JSON array of trait objects for multi-trait floor, e.g. \'[{"trait_type":"Background","value":"Blue"},{"trait_type":"Hat","value":"Crown"}]\'.',
      ),
  });

const getFloorPrompt = (_context: Context = {}) => `
Get the current floor price (cheapest active listing) for an NFT collection on SentX.

Three modes:
  1. Collection floor — pass only \`token\`.
  2. Single-trait floor — pass \`token\` + \`trait_type\` + \`value\`.
  3. Multi-trait floor — pass \`token\` + \`traits\` (JSON array).

Returns the floor price in HBAR (or null if there are no active listings).
`;

type Params = z.infer<ReturnType<typeof getFloorParameters>>;

export class SentxGetFloorTool extends BaseTool {
  method = SENTX_GET_FLOOR;
  name = "SentX Get Floor";
  description: string;
  parameters: ReturnType<typeof getFloorParameters>;

  private readonly sentx: SentxClient;

  constructor(context: Context, sentx: SentxClient) {
    super();
    this.description = getFloorPrompt(context);
    this.parameters = getFloorParameters(context);
    this.sentx = sentx;
  }

  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }

  async normalizeParams(params: Params) {
    if ((params.trait_type && !params.value) || (params.value && !params.trait_type)) {
      throw new Error("trait_type and value must be provided together");
    }
    return params;
  }

  async coreAction(params: Params) {
    return this.sentx.getFloor(params);
  }

  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getFloor"]>>;
    if (r.floor === null || r.floor === undefined) {
      return { raw: r, humanMessage: `No active listings found for token ${r.token}.` };
    }
    return { raw: r, humanMessage: `Floor for ${r.token}: ${r.floor} HBAR.` };
  };

  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(error: unknown) {
    const msg = `sentx_get_floor failed: ${error instanceof Error ? error.message : String(error)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getFloorTool =
  (sentx: SentxClient) =>
  (context: Context): BaseTool =>
    new SentxGetFloorTool(context, sentx);
