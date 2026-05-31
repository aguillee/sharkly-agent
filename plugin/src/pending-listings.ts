/**
 * In-process store of pending NFT listings, mirror of pending-purchases.
 *
 * The `sentx_list_nft` tool only PREPARES the listing (it asks SentX for an
 * unsigned approval tx) — it does NOT sign or submit anything. The actual
 * signing happens later, when the user confirms in the UI, via the server's
 * `/api/execute-listing` endpoint.
 */

import { randomUUID } from "node:crypto";

export interface PendingListing {
  id: string;
  token: string;
  serial: string | number;
  /** Price in HBAR the seller wants. */
  price: number;
  /** Seller's account ID (= the server's operator). */
  sellerAccountId: string;
  /** Sale verification code returned by SentX `listnft`. */
  saleVerificationCode: string;
  /** Unsigned approval tx bytes (empty array if SentX said skipOnChainApprove). */
  unsignedTxBytes: Uint8Array;
  /** True when SentX already has approval and the signing step is skipped. */
  skipOnChainApprove: boolean;
  /** Memo associated with the approval tx. */
  memo: string;
  /** SentX spender account that will custody the NFT during the listing. */
  spender?: string;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;
const store = new Map<string, PendingListing>();

function gc(): void {
  if (store.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [id, p] of store) if (p.expiresAt <= now) store.delete(id);
}

export function createPendingListing(
  input: Omit<PendingListing, "id" | "expiresAt">,
): PendingListing {
  gc();
  const id = randomUUID();
  const entry: PendingListing = { ...input, id, expiresAt: Date.now() + TTL_MS };
  store.set(id, entry);
  return entry;
}

export function getPendingListing(id: string): PendingListing | undefined {
  const p = store.get(id);
  if (!p) return undefined;
  if (p.expiresAt <= Date.now()) {
    store.delete(id);
    return undefined;
  }
  return p;
}

export function consumePendingListing(id: string): PendingListing | undefined {
  const p = getPendingListing(id);
  if (p) store.delete(id);
  return p;
}
