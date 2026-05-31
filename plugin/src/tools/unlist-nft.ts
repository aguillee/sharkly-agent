import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";
import { SentxClient } from "../sentx-client.js";
import { createPendingUnlisting } from "../pending-unlistings.js";

export const SENTX_UNLIST_NFT = "sentx_unlist_nft";

const params = (_c: Context = {}) =>
  z.object({
    token_address: z.string().describe('Hedera token ID of the NFT collection.'),
    serial_number: z
      .union([z.string(), z.number()])
      .describe("Serial number of the NFT you want to delist."),
  });

const prompt = (_c: Context = {}) => `
Prepare a REAL NFT delisting on the SentX marketplace.

NON-CUSTODIAL: the NFT was never moved when it was listed — it always stayed
in the seller's wallet. Unlisting revokes the allowance SentX's spender had
to move the NFT on a sale. After unlisting, the NFT is exactly where it was
(no transfer happens).

Underlying transaction:
  - HTS NFTs (Hedera native): an AccountAllowanceDeleteTransaction. Granular,
    per-NFT — only the named serial is revoked.
  - EVM NFTs (ERC-721/1155): a ContractExecuteTransaction calling
    setApprovalForAll(operator, false). This is COLLECTION-WIDE — it revokes
    the spender's permission to move ANY NFT this wallet holds in that contract.
    If the seller has other live SentX listings of the SAME EVM collection,
    they'll temporarily fail with ERC721InsufficientApproval until SentX's
    sanitizer auto-delists them. This MVP rejects EVM unlistings to avoid
    that footgun.

This tool DOES NOT execute the unlisting immediately. It calls SentX to obtain
the unsigned tx, stores the pending operation, and returns a
\`pendingUnlistingId\`. The actual signing happens later when the user confirms
in the UI.

Requirements:
  - The seller (the agent's operator account) MUST own the NFT AND have it
    currently listed on SentX.
`;

type Params = z.infer<ReturnType<typeof params>>;

interface NormalisedParams extends Params {
  sellerAccountId: string;
}

interface UnlistNftResult {
  pendingUnlistingId: string;
  token: string;
  serial: string;
  sellerAccountId: string;
  skipOnChainApprove: boolean;
  __sharklyPendingUnlisting: true;
}

export class SentxUnlistNftTool extends BaseTool {
  method = SENTX_UNLIST_NFT;
  name = "SentX Unlist NFT (prepare)";
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
      throw new Error("No operator account configured on the Hedera client.");
    }
    return { ...p, sellerAccountId: operatorId.toString() };
  }

  async coreAction(p: NormalisedParams): Promise<UnlistNftResult> {
    const req = await this.sentx.requestUnlistTx({
      token_address: p.token_address,
      serial_number: p.serial_number,
      user_address: p.sellerAccountId,
    });

    if (!req.success) {
      throw new Error(`SentX rejected the unlisting: ${req.apimessage || "(no message)"}`);
    }

    // Refuse EVM unlistings — setApprovalForAll(false) revokes collection-wide,
    // which can break the seller's other live listings in the same contract.
    const isEvm =
      req.isEvmNft === true ||
      (req.transactionType && /ContractExecute/i.test(req.transactionType));
    if (isEvm) {
      throw new Error(
        "EVM-native unlisting is collection-wide (setApprovalForAll(false) revokes ALL of your listings in this ERC contract). " +
          "Not supported in this MVP. Use SentX's UI for EVM collections.",
      );
    }

    const skip = Boolean(req.skipOnChainApprove);
    const bytesArr = req.transBytes?.data ?? [];
    if (!skip && bytesArr.length === 0) {
      throw new Error("SentX did not return unsigned transaction bytes for the unlisting.");
    }

    const pending = createPendingUnlisting({
      token: p.token_address,
      serial: p.serial_number,
      sellerAccountId: p.sellerAccountId,
      saleVerificationCode: req.saleVerificationCode,
      unsignedTxBytes: Uint8Array.from(bytesArr),
      skipOnChainApprove: skip,
    });

    return {
      pendingUnlistingId: pending.id,
      token: pending.token,
      serial: String(pending.serial),
      sellerAccountId: pending.sellerAccountId,
      skipOnChainApprove: skip,
      __sharklyPendingUnlisting: true,
    };
  }

  async secondaryAction(): Promise<any> {
    return null;
  }

  outputParser = (raw: unknown) => {
    const r = raw as UnlistNftResult;
    const note = r.skipOnChainApprove ? " (no on-chain signing needed)" : "";
    return {
      raw: r,
      humanMessage:
        `Ready to unlist NFT serial #${r.serial} of ${r.token}${note}. ` +
        `Awaiting your confirmation in the UI. [pendingUnlistingId: ${r.pendingUnlistingId}]`,
    };
  };

  async handleError(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    console.error(`[sentx_unlist_nft]`, raw);

    const notEnabled = /Endpoint not enabled/i.test(raw) || /403/.test(raw);
    const friendly = notEnabled
      ? "Unlisting is not enabled on this SentX affiliate API key yet. Contact SentX support to enable the `/v1/affiliate/market/unlistnft` endpoint for your affiliate account. (Buy and list already work.)"
      : `sentx_unlist_nft failed: ${raw}`;

    return {
      raw: { error: raw, endpointNotEnabled: notEnabled },
      humanMessage: friendly,
    };
  }
}

export const unlistNftTool =
  (sentx: SentxClient) =>
  (c: Context): BaseTool =>
    new SentxUnlistNftTool(c, sentx);
