import type { Context, Plugin } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "./sentx-client.js";

// Market core
import { getListingsTool, SENTX_GET_LISTINGS } from "./tools/get-listings.js";
import { getFloorTool, SENTX_GET_FLOOR } from "./tools/get-floor.js";
import { getActivityTool, SENTX_GET_ACTIVITY } from "./tools/get-activity.js";
import { getMarketEventsTool, SENTX_GET_MARKET_EVENTS } from "./tools/get-market-events.js";
import { getOffersTool, SENTX_GET_OFFERS } from "./tools/get-offers.js";
import { getTopCollectionsTool, SENTX_GET_TOP_COLLECTIONS } from "./tools/get-top-collections.js";
import { getUserVolumeTool, SENTX_GET_USER_VOLUME } from "./tools/get-user-volume.js";

// Stats
import { getCollectionStatsTool, SENTX_GET_COLLECTION_STATS } from "./tools/get-collection-stats.js";
import { getAggregatedStatsTool, SENTX_GET_AGGREGATED_STATS } from "./tools/get-aggregated-stats.js";
import { getTransactionsTool, SENTX_GET_TRANSACTIONS } from "./tools/get-transactions.js";

// Launchpad
import { getLaunchpadActivityTool, SENTX_GET_LAUNCHPAD_ACTIVITY } from "./tools/get-launchpad-activity.js";
import { getMintEventsTool, SENTX_GET_MINT_EVENTS } from "./tools/get-mint-events.js";

// Token introspection
import { isTokenSupportedTool, SENTX_IS_TOKEN_SUPPORTED } from "./tools/is-token-supported.js";
import { getSupportedTokensTool, SENTX_GET_SUPPORTED_TOKENS } from "./tools/get-supported-tokens.js";
import { getTokenNftsTool, SENTX_GET_TOKEN_NFTS } from "./tools/get-token-nfts.js";
import { getTokenOwnersTool, SENTX_GET_TOKEN_OWNERS } from "./tools/get-token-owners.js";
import { getTokenTraitsTool, SENTX_GET_TOKEN_TRAITS } from "./tools/get-token-traits.js";

// Bonus
import { generatePrngTool, SENTX_GENERATE_PRNG } from "./tools/generate-prng.js";

// Affiliate (write — requires SentX affiliate access)
import { buyNftTool, SENTX_BUY_NFT } from "./tools/buy-nft.js";
import { listNftTool, SENTX_LIST_NFT } from "./tools/list-nft.js";
import { unlistNftTool, SENTX_UNLIST_NFT } from "./tools/unlist-nft.js";

// Wallet introspection (mirror node — no SentX involved)
import { getMyWalletNftsTool, SENTX_GET_MY_WALLET_NFTS } from "./tools/get-my-wallet-nfts.js";

export interface CreateSharklyPluginOptions {
  /** Your SentX API key (public reads). Get one at https://sentx.io/user/settings */
  apiKey: string;
  /**
   * Optional separate key for AFFILIATE endpoints (buy/list/unlist NFT).
   * Falls back to `apiKey` when omitted.
   */
  affiliateKey?: string;
  /**
   * Hedera account ID associated with the affiliate API key. Required to
   * enable the buy_nft tool (the SentX auth challenge is signed with this
   * account's private key).
   */
  affiliateAccountId?: string;
  /**
   * Private key matching `affiliateAccountId`. ECDSA recommended.
   * Signed locally only — never sent to SentX or any network.
   */
  affiliatePrivateKey?: string;
  /** Optional project name (sent as X-Sentx-Project header). */
  project?: string;
  /** Override the API base URL (rarely needed). */
  baseUrl?: string;
  /** Hedera network for mirror-node queries. Default 'mainnet'. */
  network?: "mainnet" | "testnet" | "previewnet";
}

/**
 * 🦈 Sharkly — Hunt the Hedera NFT market with AI.
 *
 * Build a Sharkly plugin instance bound to your SentX API key.
 *
 * Read-only — exposes the full set of public SentX endpoints: market
 * listings/floor/activity/events/offers, top collections, user volume,
 * time-series stats (per-token, aggregated, transactions), launchpad
 * (activity + mint events), token introspection (supported / NFTs /
 * owners / traits) and provably-fair on-chain PRNG.
 *
 * Write endpoints (`buy / list / unlist`) require SentX affiliate approval
 * and will be added in a future version.
 *
 * @example
 * ```ts
 * import { createSharklyPlugin } from "hak-sharkly-plugin";
 *
 * const sharkly = createSharklyPlugin({ apiKey: process.env.SENTX_API_KEY! });
 *
 * const toolkit = new HederaLangchainToolkit({
 *   client,
 *   configuration: {
 *     plugins: [sharkly],
 *     context: { mode: AgentMode.AUTONOMOUS },
 *   },
 * });
 * ```
 */
export function createSharklyPlugin(opts: CreateSharklyPluginOptions): Plugin {
  const sentx = new SentxClient({
    apiKey: opts.apiKey,
    affiliateKey: opts.affiliateKey,
    affiliateAccountId: opts.affiliateAccountId,
    affiliatePrivateKey: opts.affiliatePrivateKey,
    project: opts.project,
    baseUrl: opts.baseUrl,
  });

  // buy_nft requires the full affiliate setup (key + account + signing key)
  const includeAffiliate = Boolean(
    opts.affiliateKey && opts.affiliateAccountId && opts.affiliatePrivateKey,
  );

  return {
    name: "hak-sharkly-plugin",
    version: "0.3.0",
    description:
      "Sharkly — Read SentX (Hedera NFT marketplace) + buy NFTs on-chain when affiliate access is provided.",
    tools: (context: Context) => [
      // Wallet introspection (mirror node)
      getMyWalletNftsTool(opts.network ?? "mainnet")(context),
      // Market core
      getListingsTool(sentx)(context),
      getFloorTool(sentx)(context),
      getActivityTool(sentx)(context),
      getMarketEventsTool(sentx)(context),
      getOffersTool(sentx)(context),
      getTopCollectionsTool(sentx)(context),
      getUserVolumeTool(sentx)(context),
      // Stats
      getCollectionStatsTool(sentx)(context),
      getAggregatedStatsTool(sentx)(context),
      getTransactionsTool(sentx)(context),
      // Launchpad
      getLaunchpadActivityTool(sentx)(context),
      getMintEventsTool(sentx)(context),
      // Token introspection
      isTokenSupportedTool(sentx)(context),
      getSupportedTokensTool(sentx)(context),
      getTokenNftsTool(sentx)(context),
      getTokenOwnersTool(sentx)(context),
      getTokenTraitsTool(sentx)(context),
      // Bonus
      generatePrngTool(sentx)(context),
      // Affiliate (only if an affiliate key is provided)
      ...(includeAffiliate
        ? [
            buyNftTool(sentx)(context),
            listNftTool(sentx)(context),
            unlistNftTool(sentx)(context),
          ]
        : []),
    ],
  };
}

export const sharklyPluginToolNames = {
  SENTX_GET_LISTINGS,
  SENTX_GET_FLOOR,
  SENTX_GET_ACTIVITY,
  SENTX_GET_MARKET_EVENTS,
  SENTX_GET_OFFERS,
  SENTX_GET_TOP_COLLECTIONS,
  SENTX_GET_USER_VOLUME,
  SENTX_GET_COLLECTION_STATS,
  SENTX_GET_AGGREGATED_STATS,
  SENTX_GET_TRANSACTIONS,
  SENTX_GET_LAUNCHPAD_ACTIVITY,
  SENTX_GET_MINT_EVENTS,
  SENTX_IS_TOKEN_SUPPORTED,
  SENTX_GET_SUPPORTED_TOKENS,
  SENTX_GET_TOKEN_NFTS,
  SENTX_GET_TOKEN_OWNERS,
  SENTX_GET_TOKEN_TRAITS,
  SENTX_GENERATE_PRNG,
  SENTX_BUY_NFT,
  SENTX_LIST_NFT,
  SENTX_UNLIST_NFT,
  SENTX_GET_MY_WALLET_NFTS,
} as const;

// Re-export the pending-purchase store so the consumer server can read/consume
// pending entries created by the buy tool.
export {
  createPendingPurchase,
  getPendingPurchase,
  consumePendingPurchase,
  listPendingPurchaseIds,
  type PendingPurchase,
} from "./pending-purchases.js";

// Same for listings.
export {
  createPendingListing,
  getPendingListing,
  consumePendingListing,
  type PendingListing,
} from "./pending-listings.js";

// And unlistings.
export {
  createPendingUnlisting,
  getPendingUnlisting,
  consumePendingUnlisting,
  type PendingUnlisting,
} from "./pending-unlistings.js";

export { SentxClient } from "./sentx-client.js";
export type {
  GetListingsParams, GetListingsResponse, MarketListing,
  GetFloorParams, GetFloorResponse,
  GetActivityParams, GetActivityResponse, MarketActivityItem,
  GetMarketEventsParams, GetMarketEventsResponse,
  GetOffersParams, GetOffersResponse,
  GetTopCollectionsParams, GetTopCollectionsResponse, TopCollection,
  GetUserVolumeParams, GetUserVolumeResponse,
  GetTokenStatsParams, GetTokenStatsResponse, TokenStatsRow,
  GetAggregatedStatsParams, GetAggregatedStatsResponse,
  GetTransactionsParams, GetTransactionsResponse,
  GetLaunchpadActivityParams, GetLaunchpadActivityResponse,
  GetMintEventsParams, GetMintEventsResponse,
  IsTokenSupportedParams, IsTokenSupportedResponse,
  GetTokenNftsParams, GetTokenNftsResponse,
  GetTokenOwnersParams, GetTokenOwnersResponse,
  GetSupportedTokensResponse,
  GetTokenTraitsParams, GetTokenTraitsResponse,
  GeneratePrngParams, GeneratePrngResponse,
} from "./sentx-client.js";

export default { createSharklyPlugin, sharklyPluginToolNames };
