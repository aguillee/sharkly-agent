import { z } from "zod";
import { BaseTool, type Context } from "@hashgraph/hedera-agent-kit";

export const SENTX_GET_MY_WALLET_NFTS = "get_my_wallet_nfts";

const MIRROR_HOSTS: Record<string, string> = {
  mainnet: "https://mainnet-public.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
  previewnet: "https://previewnet.mirrornode.hedera.com",
};

const params = (_c: Context = {}) =>
  z.object({
    accountId: z
      .string()
      .optional()
      .describe(
        'Hedera account ID to inspect (e.g. "0.0.10496031"). Defaults to the operator account.',
      ),
    limit: z.number().int().min(1).max(100).default(50).describe("Max NFTs to return."),
  });

const prompt = (_c: Context = {}) => `
List the NFTs currently owned by a Hedera account, querying the public mirror node.

If \`accountId\` is omitted, defaults to the agent's operator account (i.e. "the user's wallet").
This is cross-collection — returns NFTs across ALL token IDs the account holds.

Useful for: "what NFTs do I own?", "show my collection", "do I have any Dead Pixels?".

Returns each NFT with its token ID and serial, plus the spender if the NFT is currently
listed for sale (so you can detect already-listed NFTs).
`;

type Params = z.infer<ReturnType<typeof params>>;

interface NormalisedParams extends Params {
  resolvedAccountId: string;
  network: string;
}

export class GetMyWalletNftsTool extends BaseTool {
  method = SENTX_GET_MY_WALLET_NFTS;
  name = "Get My Wallet NFTs";
  description: string;
  parameters: ReturnType<typeof params>;

  constructor(_c: Context, private network: string = "mainnet") {
    super();
    this.description = prompt(_c);
    this.parameters = params(_c);
  }

  async shouldSecondaryAction(): Promise<boolean> {
    return false;
  }

  async normalizeParams(p: Params, _ctx: Context, client: any): Promise<NormalisedParams> {
    const resolved =
      p.accountId ??
      (client?.operatorAccountId ? client.operatorAccountId.toString() : null);
    if (!resolved) {
      throw new Error(
        "No accountId provided and no operator configured on the Hedera client.",
      );
    }
    return { ...p, resolvedAccountId: resolved, network: this.network };
  }

  async coreAction(p: NormalisedParams): Promise<any> {
    const host = MIRROR_HOSTS[p.network] ?? MIRROR_HOSTS.mainnet;
    const url = `${host}/api/v1/accounts/${p.resolvedAccountId}/nfts?limit=${p.limit}&order=desc`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Mirror node ${res.status} for ${p.resolvedAccountId}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  }

  async secondaryAction(): Promise<any> {
    return null;
  }

  outputParser = (raw: unknown) => {
    const r = raw as any;
    const nfts: any[] = r?.nfts ?? [];
    if (nfts.length === 0) {
      return {
        raw: r,
        humanMessage: `No NFTs found in this wallet.`,
      };
    }
    // Group by token for a cleaner human summary
    const byToken: Record<string, number[]> = {};
    for (const n of nfts) {
      const t = String(n.token_id);
      if (!byToken[t]) byToken[t] = [];
      byToken[t].push(Number(n.serial_number));
    }
    const lines = Object.entries(byToken)
      .slice(0, 10)
      .map(([t, serials]) => {
        const ser =
          serials.length <= 5
            ? serials.join(", ")
            : `${serials.slice(0, 5).join(", ")}, … (+${serials.length - 5} more)`;
        return `  • ${t} — ${serials.length} NFT(s): #${ser}`;
      })
      .join("\n");
    const more =
      Object.keys(byToken).length > 10
        ? `\n  …and ${Object.keys(byToken).length - 10} more collections.`
        : "";
    return {
      raw: r,
      humanMessage: `${nfts.length} NFT(s) across ${Object.keys(byToken).length} collection(s):\n${lines}${more}`,
    };
  };

  async handleError(error: unknown) {
    const msg = `get_my_wallet_nfts failed: ${error instanceof Error ? error.message : String(error)}`;
    return { raw: { error: msg }, humanMessage: msg };
  }
}

export const getMyWalletNftsTool =
  (network: string) =>
  (c: Context): BaseTool =>
    new GetMyWalletNftsTool(c, network);
