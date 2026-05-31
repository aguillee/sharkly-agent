import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_TOP_COLLECTIONS = "sentx_get_top_collections";

const getTopCollectionsParameters = (_context: Context = {}) =>
  z.object({
    range: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(7)
      .describe(
        "Day range for the primary volume window (e.g. 1, 7, 30). The response also always includes 24h / 7d / 30d / total windows.",
      ),
    includeUsers: z
      .boolean()
      .default(false)
      .describe("Whether to include top user statistics per collection."),
  });

const getTopCollectionsPrompt = (_context: Context = {}) => `
Get the top NFT collections on SentX ranked by trading volume.

Returns each collection's token ID, name, floor, volume (24h / 7d / 30d / total),
sales count, average sale, and highest offer. Useful for answering "what's hot on
Hedera right now?" or building a leaderboard.
`;

type Params = z.infer<ReturnType<typeof getTopCollectionsParameters>>;

export class SentxGetTopCollectionsTool extends BaseTool {
  method = SENTX_GET_TOP_COLLECTIONS;
  name = "SentX Get Top Collections";
  description: string;
  parameters: ReturnType<typeof getTopCollectionsParameters>;

  private readonly sentx: SentxClient;

  constructor(context: Context, sentx: SentxClient) {
    super();
    this.description = getTopCollectionsPrompt(context);
    this.parameters = getTopCollectionsParameters(context);
    this.sentx = sentx;
  }

  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }

  async normalizeParams(params: any, _ctx: any, _client: any): Promise<any> { return params; }
  async coreAction(params: Params) {
    return this.sentx.getTopCollections(params);
  }

  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getTopCollections"]>>;
    const cols = r.collections ?? [];
    if (cols.length === 0) {
      return { raw: r, humanMessage: "No collections returned." };
    }
    const lines = cols
      .slice(0, 10)
      .map(
        (c, i) =>
          `  ${i + 1}. ${c.name} (${c.token}) — floor ${c.floor ?? "—"} HBAR — 24h vol ${c.volume24h} — 7d vol ${c.volume7d}`,
      )
      .join("\n");
    const more = cols.length > 10 ? `\n  …and ${cols.length - 10} more.` : "";
    return { raw: r, humanMessage: `Top ${cols.length} collection(s):\n${lines}${more}` };
  };

  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(error: unknown) {
    const msg = `sentx_get_top_collections failed: ${error instanceof Error ? error.message : String(error)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getTopCollectionsTool =
  (sentx: SentxClient) =>
  (context: Context): BaseTool =>
    new SentxGetTopCollectionsTool(context, sentx);
