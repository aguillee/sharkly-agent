/**
 * Wrapper over the SentX Public API (api.sentx.io v1).
 *
 * Two access tiers:
 *   - PUBLIC reads (apikey only) — listings, floor, activity, etc.
 *   - AFFILIATE writes (apikey + wallet auth) — buynft / buynftres.
 *
 * Affiliate writes require a 2-step wallet auth flow:
 *   1) POST /auth/init  → SentX returns { payload, nonce, operationToken }
 *   2) Wallet signs the canonical "Hedera Signed Message" wrapping:
 *        msg = "\x19Hedera Signed Message:\n" + len(json) + json
 *      with the affiliate account's ECDSA private key.
 *   3) POST /auth/verify with base64(sig) → SentX returns userAuthToken (1h).
 *   4) Pass userAuthToken in the BODY (alongside other params) of buynft.
 *
 * The token is cached in-memory and auto-refreshed when it expires.
 */

import { PrivateKey } from "@hiero-ledger/sdk";

const SENTX_BASE_URL = "https://api.sentx.io";

export interface SentxClientOptions {
  apiKey: string;
  /**
   * Optional separate API key for AFFILIATE endpoints (buynft / listnft / unlistnft).
   * If omitted, falls back to `apiKey`. SentX may issue different keys for
   * public-read access vs affiliate (write) access.
   */
  affiliateKey?: string;
  /**
   * Hedera account ID that the affiliate API key is associated with.
   * Required for affiliate write endpoints — used for the wallet auth challenge.
   */
  affiliateAccountId?: string;
  /**
   * Private key matching `affiliateAccountId`. ECDSA recommended (SentX expects ECDSA).
   * Used to sign the auth challenge ONE time per hour. Never sent over the wire.
   */
  affiliatePrivateKey?: string;
  /** Optional project name issued in your SentX settings panel. Sent as X-Sentx-Project header. */
  project?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

// ─── Listings ──────────────────────────────────────────────────────

export interface GetListingsParams {
  token?: string;
  filterUserAccount?: string;
  filterTraitName?: string;
  filterTraitValue?: string;
  sortBy?: "listingDate" | "price" | "serialId";
  sortDirection?: "ASC" | "DESC";
  limit?: number;
  offset?: number;
}

export interface MarketListing {
  marketplaceListingId: number;
  nftexid: number;
  serialId: number;
  sellerAddress: string;
  isAvailableForPurchase: number;
  salePrice: number;
  listingDate: string;
  affiliateid: number | null;
  nftName: string;
  nftToken: string;
  [k: string]: unknown;
}

export interface GetListingsResponse {
  success: boolean;
  token: string;
  isCached: boolean;
  sortBy: string;
  sortDirection: string;
  limit: number;
  offset: number;
  marketListings: MarketListing[];
}

// ─── Floor ─────────────────────────────────────────────────────────

export interface GetFloorParams {
  token: string;
  trait_type?: string;
  value?: string;
  /** JSON-stringified array of {trait_type, value} objects. */
  traits?: string;
}

export interface GetFloorResponse {
  success: boolean;
  token: string;
  floor: number | null;
  [k: string]: unknown;
}

// ─── Activity ──────────────────────────────────────────────────────

export interface GetActivityParams {
  token?: string;
  serial?: string | number;
  activityFilter?: "Sales" | "Listings" | "Mints" | "Offers" | "Transfers" | string;
  amount?: number;
  page?: number;
  includePreviouslyBoughtPrice?: 0 | 1;
  hbarMarketOnly?: 0 | 1;
  paymentTokenAddress?: string;
  isHashinal?: 0 | 1;
}

export interface MarketActivityItem {
  saletype: string;
  saletypeSub?: string;
  saleMechanism?: string | null;
  salePrice: number;
  salePriceSymbol: string;
  saleDate: string;
  buyerAddress: string | null;
  sellerAddress: string | null;
  collectionName: string;
  collectionTokenAddress: string;
  nftName: string;
  nftTokenAddress: string;
  nftSerialId: number;
  nftImage?: string;
  [k: string]: unknown;
}

export interface GetActivityResponse {
  success: boolean;
  marketActivity: MarketActivityItem[];
  [k: string]: unknown;
}

// ─── Top Collections ───────────────────────────────────────────────

export interface GetTopCollectionsParams {
  /** Day range for the base stats. Other windows (24h/7d/30d/total) are always included. */
  range?: number;
  includeUsers?: 0 | 1 | boolean;
}

export interface TopCollection {
  token: string;
  name: string;
  imagetype?: string;
  description?: string;
  volume: number;
  avgSale: number;
  maxSale: number;
  sales: number;
  volumetotal: number;
  volumeprev: number;
  volume24h: number;
  volume7d: number;
  volume1m: number;
  salesprev: number;
  highestOffer: number | null;
  floor: number | null;
  [k: string]: unknown;
}

export interface GetTopCollectionsResponse {
  success: boolean;
  collections: TopCollection[];
}

// ─── Token Stats ───────────────────────────────────────────────────

export interface GetTokenStatsParams {
  token?: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  page?: number;
  limit?: number;
}

export interface TokenStatsRow {
  token: string;
  datetime: string;
  volume: number;
  floor: number;
  avgSale: number;
  sales: number;
  maxSale: number;
  minSale: number;
  listings: number;
  [k: string]: unknown;
}

export interface GetTokenStatsResponse {
  success: boolean;
  source: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  limit: number;
  totalRecords: number;
  data: TokenStatsRow[];
}

// ─── Market events (unified feed) ──────────────────────────────────

export interface GetMarketEventsParams {
  token?: string;
  serialId?: number;
  since?: string;
  eventType?: "sold" | "listed" | "delisted" | "priceChanged" | "offerAccepted" | string;
  page?: number;
  limit?: number;
}

export interface GetMarketEventsResponse {
  success: boolean;
  page: number;
  nextPage: number | null;
  lastEventDate: string | null;
  events: Array<Record<string, unknown>>;
}

// ─── Offers ────────────────────────────────────────────────────────

export interface GetOffersParams {
  token?: string;
  filterUserAccount?: string;
  statusFilterTypeId?: 0 | 1 | 2;
  serialId?: number;
  page?: number;
  limit?: number;
}

export interface GetOffersResponse {
  success: boolean;
  response?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

// ─── Aggregated stats ──────────────────────────────────────────────

export interface GetAggregatedStatsParams {
  startDate: string;
  endDate: string;
}

export interface GetAggregatedStatsResponse {
  success: boolean;
  source: string;
  dateFrom: string;
  dateTo: string;
  totalVolume: number;
  token: string;
}

// ─── Transactions ──────────────────────────────────────────────────

export interface GetTransactionsParams {
  dateFrom: string;
  dateTo: string;
  token?: string;
  page?: number;
  limit?: number;
}

export interface GetTransactionsResponse {
  success: boolean;
  source: string;
  dateFrom: string;
  dateTo: string;
  token?: string;
  page: number;
  limit: number;
  totalRecords: number;
  data: Array<Record<string, unknown>>;
}

// ─── User volume rankings ──────────────────────────────────────────

export interface GetUserVolumeParams {
  token?: string;
  page?: string | number;
  amount?: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface GetUserVolumeResponse {
  success: boolean;
  response?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

// ─── Launchpad ─────────────────────────────────────────────────────

export interface GetLaunchpadActivityParams {
  f?: string;
  token?: string;
  limit?: number;
  page?: number;
}

export interface GetLaunchpadActivityResponse {
  success: boolean;
  response?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface GetMintEventsParams {
  hideSoldOut?: "0" | "1";
  tokenAddress?: string;
  startDate?: string;
  endDate?: string;
  isForeverMint?: boolean;
}

export interface GetMintEventsResponse {
  success: boolean;
  isCached?: boolean;
  mintEvents: Array<Record<string, unknown>>;
}

// ─── Token introspection ───────────────────────────────────────────

export interface IsTokenSupportedParams {
  /** Single token or comma-separated list. */
  token: string;
}

export interface IsTokenSupportedResponse {
  success: boolean;
  [k: string]: unknown;
}

export interface GetTokenNftsParams {
  token: string;
  sortBy?: string;
  sortDirection?: "ASC" | "DESC";
  limit?: number;
  page?: number;
}

export interface GetTokenNftsResponse {
  success: boolean;
  token: string;
  isCached: boolean;
  sortBy: string;
  sortDirection: string;
  amount: number;
  page: number;
  total: number;
  nfts: Array<Record<string, unknown>>;
}

export interface GetTokenOwnersParams {
  token: string;
  amount?: number;
}

export interface GetTokenOwnersResponse {
  success: boolean;
  token: string;
  ownerCount: number;
  nftCount: number;
  amountReturned: number;
  owners: Array<Record<string, unknown>>;
}

export interface GetSupportedTokensResponse {
  success: boolean;
  supportedTokenList: Array<Record<string, unknown>>;
}

export interface GetTokenTraitsParams {
  token: string;
}

export interface GetTokenTraitsResponse {
  success: boolean;
  token: string;
  isCached: boolean;
  cacheTime?: string;
  cacheInfo?: unknown;
  traits: Record<string, unknown>;
}

// ─── AFFILIATE: Buy NFT ────────────────────────────────────────────

export interface RequestBuyTxParams {
  token_address: string;
  serial_number: string | number;
  user_address: string;
  price: string | number;
}

export interface BuyNftRequestResponse {
  success: boolean;
  apimessage: string;
  /** Unsigned Hedera transaction bytes (HTS = CryptoTransfer; EVM = AccountAllowanceApprove). */
  transBytes: { type: "Buffer"; data: number[] };
  isOwner: boolean;
  isGranted: boolean;
  saleprice: number;
  saleVerificationCode: string;
  affiliateName: string;
  affiliateCommission: number;
  totalCommission: number;
  commissionDenominator: number;
  affiliateAddress: string;
  nftexid: number;
  memo: string;
  /** EVM-only. Null for HTS NFTs. */
  transactionType: string | null;
  requiresHbarAllowance: boolean | null;
  /** Informational. True when the NFT is an EVM-native ERC-721/1155. */
  isEvmNft: boolean | null;
  transId?: unknown;
  nodeId?: unknown;
  transBase64?: unknown;
}

export interface ConfirmBuyParams {
  saleVerificationCode: string;
  transactionId: string;
}

export interface ConfirmBuyResponse {
  success: boolean;
  apimessage: string;
  /** EVM NFTs only. Hedera tx id of the server-side BatchTransaction. Null for HTS. */
  batchTransid: string | null;
}

// ─── AFFILIATE: List NFT (two-phase) ───────────────────────────────

export interface RequestListTxParams {
  token_address: string;
  serial_number: string | number;
  user_address: string;
  /** Price in HBAR (as a string number, e.g. "50"). */
  price: string | number;
}

export interface ListNftRequestResponse {
  success: boolean;
  apimessage: string;
  /** Unsigned tx the seller must sign: an NFT allowance / approval. */
  transBytes?: { type: "Buffer"; data: number[] };
  /** True when SentX skips the on-chain approval (already approved). */
  skipOnChainApprove?: boolean;
  requiresAllowanceApprove?: boolean;
  requiresPingBack?: boolean;
  spender?: string;
  saleVerificationCode: string;
  memo?: string;
  price?: string | number;
  user_address?: string;
  serial_number?: string;
  token_address?: string;
  sentient_db_nftid?: number;
}

export interface ConfirmListParams {
  saleVerificationCode: string;
  /** Signed Hedera tx ID, or "skip" if SentX returned skipOnChainApprove. */
  transactionId: string;
  user_address: string;
}

export interface ConfirmListResponse {
  success: boolean;
  apimessage: string;
  saleVerificationCode?: string;
  token_address?: string;
  serial_number?: string;
  internal_nftid?: number;
  affid?: number;
  affname?: string;
  affcomm?: number;
}

// ─── AFFILIATE: Unlist NFT (two-phase) ─────────────────────────────

export interface RequestUnlistTxParams {
  token_address: string;
  serial_number: string | number;
  user_address: string;
}

export interface UnlistNftRequestResponse {
  /** True when SentX successfully prepared the unlisting tx. */
  success: boolean;
  /** Message returned by the API. */
  apimessage: string;
  /**
   * Unsigned transaction bytes to be signed by the seller's wallet.
   * - HTS NFTs: AccountAllowanceDeleteTransaction (per-NFT revoke — granular).
   * - EVM NFTs: ContractExecuteTransaction running setApprovalForAll(operator, false)
   *   which is COLLECTION-WIDE — revokes the spender's permission over EVERY
   *   NFT the seller has in that ERC contract.
   */
  transBytes?: { type: "Buffer"; data: number[] };
  /** Server-side receipt, if any. Usually null for unlist. */
  receipt?: string | null;
  /** Hedera transaction id (set when the server fronts the submit). */
  transid?: string | null;
  /** True if the user is the owner of the NFT. */
  isOwner?: boolean;
  /** True if the user currently has the marketplace allowance to revoke. */
  isGranted?: boolean;
  /** True when the seller must sign the returned transBytes. */
  requiresAllowanceApprove?: boolean;
  /** Sale verification code — REQUIRED to pass back to /unlistnftres. */
  saleVerificationCode: string;
  /** Hedera account that signed the allowance originally. Usually the seller. */
  signingAcct?: string | null;
  /** Spender's account (HTS) or operator address (EVM) being revoked. */
  spender?: string;
  /** True when SentX needs an explicit unlistnftres call after signing. */
  requiresPingBack?: boolean;
  /** True for EVM-native NFTs. Implies setApprovalForAll(false) is collection-wide. */
  isEvmNft?: boolean;
  /** EVM only — value is "ContractExecuteTransaction" for EVM unlistings. */
  transactionType?: string | null;
  /** Optional: SentX can skip the on-chain step (then transactionId="skip"). */
  skipOnChainApprove?: boolean;
}

export interface ConfirmUnlistParams {
  saleVerificationCode: string;
  transactionId: string;
  user_address: string;
}

export interface ConfirmUnlistResponse {
  success: boolean;
  apimessage: string;
}

// ─── PRNG ──────────────────────────────────────────────────────────

export interface GeneratePrngParams {
  min?: number;
  max?: number;
  count?: number;
}

export interface GeneratePrngResponse {
  success: boolean;
  hederaTransactionId: string;
  hashScanUrl: string;
  onChainPRNG: unknown;
  serverSalt: string;
  saltCommitment: string;
  memo: string;
  range: { min: number; max: number };
  count: number;
  values: number[];
}

// ─── Client ────────────────────────────────────────────────────────

interface CachedAuthToken {
  token: string;
  /** Wall-clock ms when the token expires. */
  expiresAt: number;
}

export class SentxClient {
  private readonly apiKey: string;
  private readonly affiliateKey: string;
  private readonly affiliateAccountId?: string;
  private readonly affiliatePrivateKey?: PrivateKey;
  private readonly project?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private authCache?: CachedAuthToken;

  constructor(opts: SentxClientOptions) {
    if (!opts.apiKey) throw new Error("SentxClient: apiKey is required");
    this.apiKey = opts.apiKey;
    this.affiliateKey = opts.affiliateKey ?? opts.apiKey;
    this.affiliateAccountId = opts.affiliateAccountId;
    if (opts.affiliatePrivateKey) {
      // Auto-detect ECDSA vs ED25519. SentX issues ECDSA keys for affiliates.
      this.affiliatePrivateKey = opts.affiliatePrivateKey.startsWith("0x")
        ? PrivateKey.fromStringECDSA(opts.affiliatePrivateKey)
        : PrivateKey.fromString(opts.affiliatePrivateKey);
    }
    this.project = opts.project;
    this.baseUrl = opts.baseUrl ?? SENTX_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private url(path: string, query: Record<string, unknown> | object = {}): string {
    return this.urlWithKey(path, this.apiKey, query);
  }

  /** Build a URL using the affiliate key (for /v1/affiliate/* endpoints). */
  private affiliateUrl(path: string, query: Record<string, unknown> | object = {}): string {
    return this.urlWithKey(path, this.affiliateKey, query);
  }

  private urlWithKey(
    path: string,
    key: string,
    query: Record<string, unknown> | object,
  ): string {
    const u = new URL(`${this.baseUrl}${path}`);
    u.searchParams.set("apikey", key);
    for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
      if (v === undefined || v === null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  /** Redact apikey from any URL before logging. */
  static redact(url: string): string {
    return url.replace(/(\?|&)apikey=[^&]+/i, "$1apikey=***");
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json" };
    if (this.project) h["X-Sentx-Project"] = this.project;
    return h;
  }

  private async request<T>(url: string): Promise<T> {
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SentX API ${res.status} on ${SentxClient.redact(url)}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as T;
  }

  // ── Endpoints (read-only) ───────────────────────────────────────

  getListings(params: GetListingsParams = {}): Promise<GetListingsResponse> {
    return this.request(this.url("/v1/public/market/listings", params));
  }

  getFloor(params: GetFloorParams): Promise<GetFloorResponse> {
    return this.request(this.url("/v1/public/market/floor", params));
  }

  getActivity(params: GetActivityParams = {}): Promise<GetActivityResponse> {
    return this.request(this.url("/v1/public/market/activity", params));
  }

  getTopCollections(params: GetTopCollectionsParams = {}): Promise<GetTopCollectionsResponse> {
    return this.request(
      this.url("/v1/public/market/topcollections", {
        ...params,
        includeUsers: params.includeUsers === true ? 1 : params.includeUsers === false ? 0 : params.includeUsers,
      }),
    );
  }

  getTokenStats(params: GetTokenStatsParams): Promise<GetTokenStatsResponse> {
    return this.request(this.url("/v1/public/market/stats/token", params));
  }

  // ── Market — extended ──

  getMarketEvents(params: GetMarketEventsParams = {}): Promise<GetMarketEventsResponse> {
    return this.request(this.url("/v1/public/market/events", params));
  }

  getOffers(params: GetOffersParams = {}): Promise<GetOffersResponse> {
    return this.request(this.url("/v1/public/market/offers", params));
  }

  getAggregatedStats(params: GetAggregatedStatsParams): Promise<GetAggregatedStatsResponse> {
    return this.request(this.url("/v1/public/market/stats/aggregated", params));
  }

  getTransactions(params: GetTransactionsParams): Promise<GetTransactionsResponse> {
    return this.request(this.url("/v1/public/market/stats/transactions", params));
  }

  getUserVolume(params: GetUserVolumeParams = {}): Promise<GetUserVolumeResponse> {
    return this.request(this.url("/v1/public/market/userVolume", params));
  }

  // ── Launchpad ──

  getLaunchpadActivity(params: GetLaunchpadActivityParams = {}): Promise<GetLaunchpadActivityResponse> {
    return this.request(this.url("/v1/public/launchpad/activity", params));
  }

  getMintEvents(params: GetMintEventsParams = {}): Promise<GetMintEventsResponse> {
    return this.request(this.url("/v1/public/launchpad/mintevents", params));
  }

  // ── Token introspection ──

  isTokenSupported(params: IsTokenSupportedParams): Promise<IsTokenSupportedResponse> {
    return this.request(this.url("/v1/public/token/issupported", params));
  }

  getTokenNfts(params: GetTokenNftsParams): Promise<GetTokenNftsResponse> {
    return this.request(this.url("/v1/public/token/nfts", params));
  }

  getTokenOwners(params: GetTokenOwnersParams): Promise<GetTokenOwnersResponse> {
    return this.request(this.url("/v1/public/token/owners", params));
  }

  getSupportedTokens(): Promise<GetSupportedTokensResponse> {
    return this.request(this.url("/v1/public/token/supportedlist"));
  }

  getTokenTraits(params: GetTokenTraitsParams): Promise<GetTokenTraitsResponse> {
    return this.request(this.url("/v1/public/token/traits", params));
  }

  // ── PRNG ──

  generatePrng(params: GeneratePrngParams = {}): Promise<GeneratePrngResponse> {
    return this.request(this.url("/v1/public/prng/generate", params));
  }

  // ── AFFILIATE: List NFT (two-phase) ──

  /**
   * Phase 1 of a listing: ask SentX for the unsigned approval transaction
   * that the SELLER (user_address) must sign so SentX can custody the NFT
   * for sale.
   */
  async requestListTx(params: RequestListTxParams): Promise<ListNftRequestResponse> {
    const userAuthToken = await this.getUserAuthToken();
    const url = this.affiliateUrl("/v1/affiliate/market/listnft");
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        userAuthToken,
        token_address: params.token_address,
        serial_number: String(params.serial_number),
        user_address: params.user_address,
        price: String(params.price),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SentX requestListTx ${res.status} on ${SentxClient.redact(url)}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as ListNftRequestResponse;
  }

  /**
   * Phase 2 of a listing: after the seller signed the approval transaction
   * (or skip if SentX said so), tell SentX to publish the listing.
   */
  async confirmList(params: ConfirmListParams): Promise<ConfirmListResponse> {
    const userAuthToken = await this.getUserAuthToken();
    const url = this.affiliateUrl("/v1/affiliate/market/listnftres");
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        userAuthToken,
        saleVerificationCode: params.saleVerificationCode,
        transactionId: params.transactionId,
        user_address: params.user_address,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SentX confirmList ${res.status} on ${SentxClient.redact(url)}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as ConfirmListResponse;
  }

  // ── AFFILIATE: Unlist NFT (two-phase) ──

  async requestUnlistTx(params: RequestUnlistTxParams): Promise<UnlistNftRequestResponse> {
    const userAuthToken = await this.getUserAuthToken();
    const url = this.affiliateUrl("/v1/affiliate/market/unlistnft");
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        userAuthToken,
        token_address: params.token_address,
        serial_number: String(params.serial_number),
        user_address: params.user_address,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SentX requestUnlistTx ${res.status} on ${SentxClient.redact(url)}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as UnlistNftRequestResponse;
  }

  async confirmUnlist(params: ConfirmUnlistParams): Promise<ConfirmUnlistResponse> {
    const userAuthToken = await this.getUserAuthToken();
    const url = this.affiliateUrl("/v1/affiliate/market/unlistnftres");
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        userAuthToken,
        saleVerificationCode: params.saleVerificationCode,
        transactionId: params.transactionId,
        user_address: params.user_address,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SentX confirmUnlist ${res.status} on ${SentxClient.redact(url)}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as ConfirmUnlistResponse;
  }

  // ── AFFILIATE: Wallet auth (init + verify) ──
  //
  // SentX requires a wallet-signed challenge before any affiliate write
  // endpoint. The exact byte sequence to sign is NOT documented in the
  // swagger ("Base64-encoded signature data from wallet signing") and our
  // signing experiments are pending the SentX team's confirmation.
  //
  // These methods are wired up so that the day we know the format, we
  // only need to plug the signer in `verifyAuthSignature`.

  /** Phase 1 of wallet auth — get a challenge payload to sign. */
  async initAuthChallenge(userAddress: string): Promise<{
    success: boolean;
    payload: { action: string; url: string; data: Record<string, unknown> };
    nonce: string;
    operationToken: string;
  }> {
    const url = this.affiliateUrl("/v1/affiliate/auth/init");
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({ user_address: userAddress }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SentX initAuthChallenge ${res.status} on ${SentxClient.redact(url)}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as any;
  }

  /** Phase 2 of wallet auth — submit base64 signature, get back a userAuthToken. */
  async verifyAuthSignature(input: {
    userAddress: string;
    operationToken: string;
    nonce: string;
    userSignature: string; // base64
  }): Promise<{
    success: boolean;
    verified: boolean;
    userAuthToken?: string;
    expiresIn?: number;
    apimessage?: string;
  }> {
    const url = this.affiliateUrl("/v1/affiliate/auth/verify");
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        user_address: input.userAddress,
        operationToken: input.operationToken,
        nonce: input.nonce,
        userSignature: input.userSignature,
      }),
    });
    return (await res.json()) as any;
  }

  // ── AFFILIATE: Wallet auth (token cached for 1 hour) ──

  /**
   * Build the canonical message that SentX expects to be signed.
   * Format mirrors EIP-191 ("Ethereum Signed Message"):
   *   "\x19Hedera Signed Message:\n" + len(payload_json) + payload_json
   */
  private buildSignedMessage(payload: unknown): Buffer {
    const json = JSON.stringify(payload);
    return Buffer.from(`\x19Hedera Signed Message:\n${json.length}${json}`);
  }

  /**
   * Run the full /auth/init → sign → /auth/verify flow and return the
   * resulting userAuthToken. Throws if affiliate credentials are missing
   * or the signature is rejected.
   */
  private async fetchNewAuthToken(): Promise<CachedAuthToken> {
    if (!this.affiliateAccountId || !this.affiliatePrivateKey) {
      throw new Error(
        "Affiliate auth requires both affiliateAccountId and affiliatePrivateKey on the SentxClient.",
      );
    }

    // 1. Get challenge
    const initUrl = this.affiliateUrl("/v1/affiliate/auth/init");
    const initRes = await this.fetchImpl(initUrl, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({ user_address: this.affiliateAccountId }),
    });
    if (!initRes.ok) {
      const text = await initRes.text().catch(() => "");
      throw new Error(
        `SentX /auth/init ${initRes.status} on ${SentxClient.redact(initUrl)}: ${text.slice(0, 300)}`,
      );
    }
    const init = (await initRes.json()) as {
      success: boolean;
      payload: unknown;
      nonce: string;
      operationToken: string;
    };

    // 2. Sign challenge
    const messageBytes = this.buildSignedMessage(init.payload);
    const sigBytes = this.affiliatePrivateKey.sign(messageBytes);
    const userSignature = Buffer.from(sigBytes).toString("base64");

    // 3. Verify
    const verifyUrl = this.affiliateUrl("/v1/affiliate/auth/verify");
    const verifyRes = await this.fetchImpl(verifyUrl, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        user_address: this.affiliateAccountId,
        operationToken: init.operationToken,
        nonce: init.nonce,
        userSignature,
      }),
    });
    const verify = (await verifyRes.json()) as {
      success: boolean;
      verified?: boolean;
      userAuthToken?: string;
      expiresIn?: number;
      apimessage?: string;
    };
    if (!verify.userAuthToken) {
      throw new Error(
        `SentX /auth/verify rejected the signature: ${verify.apimessage ?? JSON.stringify(verify)}`,
      );
    }

    const ttlMs = (verify.expiresIn ?? 3600) * 1000;
    // Refresh 60s before actual expiry to avoid races.
    return {
      token: verify.userAuthToken,
      expiresAt: Date.now() + ttlMs - 60_000,
    };
  }

  /**
   * Return a valid userAuthToken, fetching or refreshing as needed.
   * Cached for ~59 minutes (SentX TTL minus 60s safety margin).
   */
  private async getUserAuthToken(): Promise<string> {
    if (this.authCache && this.authCache.expiresAt > Date.now()) {
      return this.authCache.token;
    }
    this.authCache = await this.fetchNewAuthToken();
    return this.authCache.token;
  }

  /**
   * Force the next call to obtain a fresh token. Useful for tests or after
   * the credentials have been rotated.
   */
  invalidateAuthToken(): void {
    this.authCache = undefined;
  }

  // ── AFFILIATE: Buy NFT (two-phase) ──

  /**
   * Phase 1 of a buy: ask SentX for an unsigned transaction the buyer wallet
   * must sign. The returned `saleVerificationCode` is required for phase 2.
   *
   * NOTE: SentX expects ALL parameters (and the userAuthToken) in the JSON
   * body — query-string params are ignored when a body is present.
   */
  async requestBuyTx(params: RequestBuyTxParams): Promise<BuyNftRequestResponse> {
    const userAuthToken = await this.getUserAuthToken();
    const url = this.affiliateUrl("/v1/affiliate/market/buynft");
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        userAuthToken,
        token_address: params.token_address,
        serial_number: String(params.serial_number),
        user_address: params.user_address,
        price: String(params.price),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SentX requestBuyTx ${res.status} on ${SentxClient.redact(url)}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as BuyNftRequestResponse;
  }

  /**
   * Phase 2 of a buy: after the signed Hedera transaction was submitted to
   * the network, tell SentX to record the sale and pay out commissions.
   */
  async confirmBuy(params: ConfirmBuyParams): Promise<ConfirmBuyResponse> {
    const userAuthToken = await this.getUserAuthToken();
    const url = this.affiliateUrl("/v1/affiliate/market/buynftres");
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        userAuthToken,
        saleVerificationCode: params.saleVerificationCode,
        transactionId: params.transactionId,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SentX confirmBuy ${res.status} on ${SentxClient.redact(url)}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as ConfirmBuyResponse;
  }
}
