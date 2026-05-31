import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";
import { createPendingPurchase } from "../pending-purchases.js";

export const SENTX_BUY_NFT = "sentx_buy_nft";

const params = (_c: Context = {}) =>
  z.object({
    token_address: z
      .string()
      .describe('Hedera token ID of the NFT collection, e.g. "0.0.878200".'),
    serial_number: z
      .union([z.string(), z.number()])
      .describe("Serial number of the specific NFT to buy."),
    price: z
      .union([z.string(), z.number()])
      .describe(
        "Expected sale price in HBAR. Must match the current listing price. Get it from sentx_get_listings first.",
      ),
  });

const prompt = (_c: Context = {}) => `
Prepare a REAL NFT purchase on the SentX marketplace (Hedera mainnet).

This tool DOES NOT execute the purchase immediately. It calls SentX to obtain
an unsigned Hedera transaction, stores the pending operation, and returns a
\`pendingId\`. The actual signing and on-chain submission happens later, when
the user confirms in the UI via the server's \`/api/execute-purchase\` endpoint.

Flow:
  1. Caller invokes this tool with token + serial + price.
  2. Tool asks SentX for the unsigned tx and saves it as a pending purchase.
  3. Tool returns a human-readable summary including the \`pendingId\`.
  4. UI shows a confirmation modal with the summary.
  5. If the user confirms, the server signs the tx with the operator key,
     submits it to Hedera mainnet, and tells SentX to finalize the sale.

Always call sentx_get_listings first so you know the current serial and price.

Only HTS-native NFTs are fully supported. EVM-native NFTs will be rejected
with a clear error in this MVP.
`;

type Params = z.infer<ReturnType<typeof params>>;

interface NormalisedParams extends Params {
  buyerAccountId: string;
}

interface BuyNftResult {
  pendingId: string;
  token: string;
  serial: string;
  /** Sale price in HBAR. */
  price: number;
  /** Affiliate commission as a percentage numerator (denominator below). */
  affiliateCommissionPct: number;
  /** Total commission as a percentage numerator. e.g. 2 / 100 = 2%. */
  totalCommissionPct: number;
  commissionDenominator: number;
  /** Commission in HBAR (already multiplied out). */
  totalCommissionHbar: number;
  /** Final cost to the buyer in HBAR (price + commission). */
  totalCostHbar: number;
  memo: string;
  buyerAccountId: string;
  isEvmNft: boolean;
  __sharklyPendingPurchase: true;
}

export class SentxBuyNftTool extends BaseTool {
  method = SENTX_BUY_NFT;
  name = "SentX Buy NFT (prepare)";
  description: string;
  parameters: ReturnType<typeof params>;

  private readonly sentx: SentxClient;

  constructor(_c: Context, sentx: SentxClient) {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
    this.sentx = sentx;
  }

  async shouldSecondaryAction(): Promise<boolean> {
    return false;
  }

  async normalizeParams(p: Params, _ctx: Context, client: any): Promise<NormalisedParams> {
    const operatorId = client?.operatorAccountId;
    if (!operatorId) {
      throw new Error(
        "No operator account configured on the Hedera client. Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY.",
      );
    }
    return { ...p, buyerAccountId: operatorId.toString() };
  }

  async coreAction(p: NormalisedParams): Promise<BuyNftResult> {
    console.log(
      `[sentx_buy_nft] requesting unsigned tx — token=${p.token_address} serial=${p.serial_number} price=${p.price} buyer=${p.buyerAccountId}`,
    );

    let req;
    try {
      req = await this.sentx.requestBuyTx({
        token_address: p.token_address,
        serial_number: p.serial_number,
        user_address: p.buyerAccountId,
        price: p.price,
      });
    } catch (httpErr) {
      console.error(`[sentx_buy_nft] HTTP error from SentX:`, httpErr);
      throw httpErr;
    }

    console.log(
      `[sentx_buy_nft] SentX response — success=${req.success} isEvmNft=${req.isEvmNft} ` +
        `saleprice=${req.saleprice} txBytes=${req.transBytes?.data?.length ?? 0} bytes ` +
        `apimessage="${req.apimessage}"`,
    );

    if (!req.success) {
      throw new Error(`SentX rejected the purchase: ${req.apimessage || "(no message)"}`);
    }
    if (req.isEvmNft === true) {
      throw new Error(
        "This NFT is EVM-native (ERC-721/1155). The MVP only supports HTS-native NFTs.",
      );
    }
    if (!req.transBytes?.data?.length) {
      throw new Error("SentX did not return any unsigned transaction bytes.");
    }

    // SentX returns commission as percentage numerators (denominator below).
    // e.g. totalCommission=2, commissionDenominator=100 => 2% of price.
    // IMPORTANT: the commission is taken FROM the sale price (split between
    // seller, affiliate and SentX) — it is NOT added on top. The buyer pays
    // exactly `saleprice` and the seller receives `saleprice - commission`.
    const denom = req.commissionDenominator ?? 100;
    const totalCommissionPct = Number(req.totalCommission ?? 0);
    const affiliateCommissionPct = Number(req.affiliateCommission ?? 0);
    const totalCommissionHbar = (req.saleprice * totalCommissionPct) / denom;
    const totalCostHbar = req.saleprice; // buyer pays the listed price, no extras

    const pending = createPendingPurchase({
      token: p.token_address,
      serial: p.serial_number,
      price: req.saleprice,
      buyerAccountId: p.buyerAccountId,
      saleVerificationCode: req.saleVerificationCode,
      unsignedTxBytes: Uint8Array.from(req.transBytes.data),
      affiliateCommission: affiliateCommissionPct,
      totalCommission: totalCommissionPct,
      memo: req.memo ?? "",
      isEvmNft: Boolean(req.isEvmNft),
    });

    return {
      pendingId: pending.id,
      token: pending.token,
      serial: String(pending.serial),
      price: pending.price,
      affiliateCommissionPct,
      totalCommissionPct,
      commissionDenominator: denom,
      totalCommissionHbar,
      totalCostHbar,
      memo: pending.memo,
      buyerAccountId: pending.buyerAccountId,
      isEvmNft: pending.isEvmNft,
      __sharklyPendingPurchase: true,
    };
  }

  async secondaryAction(): Promise<any> {
    return null;
  }

  outputParser = (raw: unknown) => {
    const r = raw as BuyNftResult;
    return {
      raw: r,
      humanMessage:
        `Ready to buy NFT serial #${r.serial} of ${r.token} for ${r.price} HBAR ` +
        `(${r.totalCommissionPct}% commission ≈ ${r.totalCommissionHbar.toFixed(4)} HBAR taken from price, ` +
        `seller receives ~${(r.price - r.totalCommissionHbar).toFixed(4)} HBAR). ` +
        `Awaiting your confirmation in the UI. [pendingId: ${r.pendingId}]`,
    };
  };

  async handleError(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    console.error(`[sentx_buy_nft]`, raw);
    if (error instanceof Error && error.stack) console.error(error.stack);

    // Detect the well-known SentX 500 caused by missing affiliate signing
    // account setup. Give the LLM a friendly, actionable message instead of
    // a stack trace it might paraphrase as "issue on SentX's end".
    const isSigningAcct = raw.includes("signingAcct");
    const friendly = isSigningAcct
      ? "Buying is temporarily disabled: SentX has not yet associated a signing account to this affiliate API key. " +
        "The Sharkly team is in touch with SentX support. All read-only tools work normally."
      : `sentx_buy_nft failed: ${raw}`;

    return {
      raw: { error: raw, affiliateSetupPending: isSigningAcct },
      humanMessage: friendly,
    };
  }
}

export const buyNftTool =
  (sentx: SentxClient) =>
  (c: Context): BaseTool =>
    new SentxBuyNftTool(c, sentx);
