import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";
import { createPendingListing } from "../pending-listings.js";

export const SENTX_LIST_NFT = "sentx_list_nft";

const params = (_c: Context = {}) =>
  z.object({
    token_address: z
      .string()
      .describe('Hedera token ID of the NFT collection, e.g. "0.0.878200".'),
    serial_number: z
      .union([z.string(), z.number()])
      .describe("Serial number of the NFT you want to list (you must own it)."),
    price: z
      .union([z.string(), z.number()])
      .describe("Asking price in HBAR (whole units, e.g. 50)."),
  });

const prompt = (_c: Context = {}) => `
Prepare a REAL NFT listing on the SentX marketplace (Hedera mainnet).

NON-CUSTODIAL: the NFT NEVER leaves the seller's wallet. The signature
authorizes SentX's spender account (via Hedera AccountAllowanceApproveTransaction)
to move that specific NFT — and only that NFT — if and when someone buys it.
Until then, it remains in the seller's wallet.

This tool DOES NOT execute the listing immediately. It calls SentX to obtain
the unsigned allowance-approve transaction, stores the pending operation, and
returns a \`pendingListingId\`. The actual signing happens later when the user
confirms in the UI via \`/api/execute-listing\`.

Requirements:
  - The seller (the agent's operator account) MUST own the NFT.
  - The collection's token must already be associated with the seller's account
    (it will be, since they own a serial of it).

Flow:
  1. Caller invokes this tool with token + serial + price.
  2. Tool asks SentX for the unsigned allowance-approve and stores it.
  3. UI shows a confirmation modal with the listing summary.
  4. If the user confirms, the server signs the approval, submits it, and
     tells SentX to publish the listing.

Only HTS-native NFTs are fully supported. EVM-native NFTs will be rejected
with a clear error in this MVP.
`;

type Params = z.infer<ReturnType<typeof params>>;

interface NormalisedParams extends Params {
  sellerAccountId: string;
}

interface ListNftResult {
  pendingListingId: string;
  token: string;
  serial: string;
  price: number;
  sellerAccountId: string;
  memo: string;
  spender?: string;
  skipOnChainApprove: boolean;
  /** Marker for the server to recognise this pending listing. */
  __sharklyPendingListing: true;
}

export class SentxListNftTool extends BaseTool {
  method = SENTX_LIST_NFT;
  name = "SentX List NFT (prepare)";
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
    return { ...p, sellerAccountId: operatorId.toString() };
  }

  async coreAction(p: NormalisedParams): Promise<ListNftResult> {
    const req = await this.sentx.requestListTx({
      token_address: p.token_address,
      serial_number: p.serial_number,
      user_address: p.sellerAccountId,
      price: p.price,
    });

    if (!req.success) {
      throw new Error(`SentX rejected the listing: ${req.apimessage || "(no message)"}`);
    }

    const skipOnChainApprove = Boolean(req.skipOnChainApprove);
    const bytesArr = req.transBytes?.data ?? [];
    if (!skipOnChainApprove && bytesArr.length === 0) {
      throw new Error("SentX did not return unsigned transaction bytes for the listing approval.");
    }

    const pending = createPendingListing({
      token: p.token_address,
      serial: p.serial_number,
      price: Number(p.price),
      sellerAccountId: p.sellerAccountId,
      saleVerificationCode: req.saleVerificationCode,
      unsignedTxBytes: Uint8Array.from(bytesArr),
      skipOnChainApprove,
      memo: req.memo ?? "",
      spender: req.spender,
    });

    return {
      pendingListingId: pending.id,
      token: pending.token,
      serial: String(pending.serial),
      price: pending.price,
      sellerAccountId: pending.sellerAccountId,
      memo: pending.memo,
      spender: pending.spender,
      skipOnChainApprove,
      __sharklyPendingListing: true,
    };
  }

  async secondaryAction(): Promise<any> {
    return null;
  }

  outputParser = (raw: unknown) => {
    const r = raw as ListNftResult;
    const skipNote = r.skipOnChainApprove
      ? " (no on-chain approval needed — SentX already has the allowance)"
      : "";
    return {
      raw: r,
      humanMessage:
        `Ready to list NFT serial #${r.serial} of ${r.token} for ${r.price} HBAR${skipNote}. ` +
        `Non-custodial: the NFT stays in your wallet; SentX only gets permission to move it on a sale. ` +
        `Awaiting your confirmation in the UI. [pendingListingId: ${r.pendingListingId}]`,
    };
  };

  async handleError(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    console.error(`[sentx_list_nft]`, raw);
    if (error instanceof Error && error.stack) console.error(error.stack);

    const notEnabled = /Endpoint not enabled/i.test(raw);
    const friendly = notEnabled
      ? "Listing is not enabled on this SentX affiliate API key yet. Contact SentX support to enable the `/v1/affiliate/market/listnft` endpoint for your affiliate account."
      : `sentx_list_nft failed: ${raw}`;

    return {
      raw: { error: raw, endpointNotEnabled: notEnabled },
      humanMessage: friendly,
    };
  }
}

export const listNftTool =
  (sentx: SentxClient) =>
  (c: Context): BaseTool =>
    new SentxListNftTool(c, sentx);
