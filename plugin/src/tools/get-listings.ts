import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import type { Client } from "@hiero-ledger/sdk";
import { SentxClient } from "../sentx-client.js";

export const SENTX_GET_LISTINGS = "sentx_get_listings";

const getListingsParameters = (_context: Context = {}) =>
  z.object({
    token: z
      .string()
      .describe(
        'Hedera token ID of the NFT collection, e.g. "0.0.878200". Required to filter by collection.',
      ),
    sortBy: z
      .enum(["listingDate", "price", "serialId"])
      .default("price")
      .describe("Field to sort by. Use 'price' to find the cheapest listings (floor)."),
    sortDirection: z
      .enum(["ASC", "DESC"])
      .default("ASC")
      .describe("ASC for cheapest first, DESC for most expensive first."),
    limit: z.number().int().min(1).max(100).default(10).describe("Max number of listings to return."),
    filterTraitName: z
      .string()
      .optional()
      .describe('Optional trait name to filter by, e.g. "Element".'),
    filterTraitValue: z
      .string()
      .optional()
      .describe('Optional trait value to filter by, e.g. "Fire". Requires filterTraitName.'),
  });

const getListingsPrompt = (_context: Context = {}) => `
List NFTs currently for sale on the SentX marketplace for a given Hedera collection.

Use this BEFORE calling sentx_buy_nft so you know which serial numbers are available
and at what price. To find the cheapest NFT in a collection, pass sortBy="price"
and sortDirection="ASC" with limit=1.

Returns an array of listings with serialId, salePrice (HBAR), sellerAddress and nftName.
`;

type GetListingsParams = z.infer<ReturnType<typeof getListingsParameters>>;

export class SentxGetListingsTool extends BaseTool {
  method = SENTX_GET_LISTINGS;
  name = "SentX Get Listings";
  description: string;
  parameters: ReturnType<typeof getListingsParameters>;

  private readonly sentx: SentxClient;

  constructor(context: Context, sentx: SentxClient) {
    super();
    this.description = getListingsPrompt(context);
    this.parameters = getListingsParameters(context);
    this.sentx = sentx;
  }

  // Query-only tool — no on-chain transaction. Skip the secondary action.
  async shouldSecondaryAction(_coreActionResult: any, _ctx: Context): Promise<boolean> { return false; }

  async normalizeParams(params: GetListingsParams) {
    if (params.filterTraitValue && !params.filterTraitName) {
      throw new Error("filterTraitValue requires filterTraitName");
    }
    return params;
  }

  async coreAction(params: GetListingsParams) {
    const res = await this.sentx.getListings(params);
    return res;
  }

  outputParser = (raw: unknown) => {
    const r = raw as Awaited<ReturnType<SentxClient["getListings"]>>;
    const listings = r.marketListings ?? [];
    if (listings.length === 0) {
      return {
        raw: r,
        humanMessage: `No listings found for token ${r.token}.`,
      };
    }
    const lines = listings
      .slice(0, 10)
      .map(
        (l) =>
          `  • ${l.nftName} (serial #${l.serialId}) — ${l.salePrice} HBAR — seller ${l.sellerAddress}`,
      )
      .join("\n");
    const more = listings.length > 10 ? `\n  …and ${listings.length - 10} more.` : "";
    return {
      raw: r,
      humanMessage: `Found ${listings.length} listing(s) for ${r.token} (sorted by ${r.sortBy} ${r.sortDirection}):\n${lines}${more}`,
    };
  };

  async secondaryAction(_req: any, _client: any, _ctx: any): Promise<any> { return null; }
  async handleError(error: unknown) {
    const msg = `sentx_get_listings failed: ${error instanceof Error ? error.message : String(error)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getListingsTool =
  (sentx: SentxClient) =>
  (context: Context): BaseTool =>
    new SentxGetListingsTool(context, sentx);
