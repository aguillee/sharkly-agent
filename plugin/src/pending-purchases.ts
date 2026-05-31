/**
 * In-process store of pending NFT purchases.
 *
 * Why this exists: the `sentx_buy_nft` tool only PREPARES a purchase (it asks
 * SentX for an unsigned transaction) — it does NOT sign or submit anything.
 * The actual signing happens later, when the user confirms in the UI, via the
 * server's `/api/execute-purchase` endpoint.
 *
 * To bridge those two steps without serializing the unsigned-tx bytes through
 * the LLM message stream, we keep the payload here, keyed by a fresh UUID
 * (`pendingId`). The tool inserts the payload + returns the id; the server
 * reads it back when the user confirms.
 *
 * The map lives in the plugin module, so both the plugin tool and the server
 * (which imports the plugin) share the same instance within one Node process.
 *
 * This is acceptable for a local server / single-instance deploy. For a
 * multi-instance / serverless deploy, swap this for Redis / Vercel KV.
 */

import { randomUUID } from "node:crypto";

export interface PendingPurchase {
  id: string;
  /** Hedera token ID of the NFT collection, e.g. "0.0.878200". */
  token: string;
  /** Serial number of the specific NFT. */
  serial: string | number;
  /** Sale price in HBAR (as SentX returned it). */
  price: number;
  /** Buyer's Hedera account ID (must match the server's operator). */
  buyerAccountId: string;
  /** Sale verification code returned by SentX `buynft`. Required for `buynftres`. */
  saleVerificationCode: string;
  /** Unsigned Hedera transaction bytes returned by SentX. Deserialize with `Transaction.fromBytes`. */
  unsignedTxBytes: Uint8Array;
  /** Affiliate commission amount in HBAR. */
  affiliateCommission: number;
  /** Total commission amount in HBAR. */
  totalCommission: number;
  /** Memo associated with the on-chain transfer. */
  memo: string;
  /** Whether this is an EVM-native NFT (different signing flow). */
  isEvmNft: boolean;
  /** Wall-clock time (ms since epoch) when this entry becomes invalid. */
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 200;

const store = new Map<string, PendingPurchase>();

function gc(): void {
  if (store.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [id, p] of store) {
    if (p.expiresAt <= now) store.delete(id);
  }
}

export function createPendingPurchase(
  input: Omit<PendingPurchase, "id" | "expiresAt">,
): PendingPurchase {
  gc();
  const id = randomUUID();
  const entry: PendingPurchase = {
    ...input,
    id,
    expiresAt: Date.now() + TTL_MS,
  };
  store.set(id, entry);
  return entry;
}

export function getPendingPurchase(id: string): PendingPurchase | undefined {
  const p = store.get(id);
  if (!p) return undefined;
  if (p.expiresAt <= Date.now()) {
    store.delete(id);
    return undefined;
  }
  return p;
}

export function consumePendingPurchase(id: string): PendingPurchase | undefined {
  const p = getPendingPurchase(id);
  if (p) store.delete(id);
  return p;
}

/** For debugging / observability. */
export function listPendingPurchaseIds(): string[] {
  return [...store.keys()];
}
