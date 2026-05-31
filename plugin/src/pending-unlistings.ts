/**
 * In-process store of pending NFT unlistings, mirror of pending-listings.
 *
 * The `sentx_unlist_nft` tool only PREPARES the unlisting (it asks SentX for
 * an unsigned tx that revokes the marketplace allowance) — it does NOT sign
 * or submit anything. The actual signing happens later via
 * `/api/execute-unlisting`.
 */

import { randomUUID } from "node:crypto";

export interface PendingUnlisting {
  id: string;
  token: string;
  serial: string | number;
  sellerAccountId: string;
  saleVerificationCode: string;
  unsignedTxBytes: Uint8Array;
  skipOnChainApprove: boolean;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;
const store = new Map<string, PendingUnlisting>();

function gc(): void {
  if (store.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [id, p] of store) if (p.expiresAt <= now) store.delete(id);
}

export function createPendingUnlisting(
  input: Omit<PendingUnlisting, "id" | "expiresAt">,
): PendingUnlisting {
  gc();
  const id = randomUUID();
  const entry: PendingUnlisting = { ...input, id, expiresAt: Date.now() + TTL_MS };
  store.set(id, entry);
  return entry;
}

export function getPendingUnlisting(id: string): PendingUnlisting | undefined {
  const p = store.get(id);
  if (!p) return undefined;
  if (p.expiresAt <= Date.now()) {
    store.delete(id);
    return undefined;
  }
  return p;
}

export function consumePendingUnlisting(id: string): PendingUnlisting | undefined {
  const p = getPendingUnlisting(id);
  if (p) store.delete(id);
  return p;
}
