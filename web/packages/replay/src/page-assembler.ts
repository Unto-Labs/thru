/**
 * Page Assembler for multi-page account updates.
 *
 * Large accounts are split into multiple AccountPage messages (4KB chunks).
 * This module buffers pages and emits complete account data when all pages
 * for a given sequence number are received.
 */

import type { AccountMeta, AccountPage } from "@thru/sdk/proto";
import type { AccountUpdate } from "@thru/sdk/proto";

/** Standard page size for account data (4KB) */
export const PAGE_SIZE = 4096;

/**
 * Represents a buffered page update waiting for assembly
 */
interface BufferedPage {
  pageIdx: number;
  pageData: Uint8Array;
}

/**
 * State for an account update being assembled from pages
 */
interface PendingUpdate {
  slot: bigint;
  seq: bigint;
  meta: AccountMeta;
  pages: Map<number, BufferedPage>;
  expectedPageCount: number;
  receivedAt: number;
}

/**
 * Assembled account data ready for processing
 */
export interface AssembledAccount {
  address: Uint8Array;
  slot: bigint;
  seq: bigint;
  meta: AccountMeta;
  data: Uint8Array;
  isDelete: boolean;
}

/**
 * Options for the PageAssembler
 */
export interface PageAssemblerOptions {
  /**
   * Timeout in milliseconds for incomplete page assemblies.
   * After this duration, incomplete assemblies are discarded.
   * Default: 30000 (30 seconds)
   */
  assemblyTimeout?: number;

  /**
   * Maximum number of pending assemblies per address.
   * Older assemblies are evicted when limit is exceeded.
   * Default: 10
   */
  maxPendingPerAddress?: number;
}

/**
 * Convert address bytes to hex string for use as map key
 */
function addressToKey(address: Uint8Array): string {
  return Array.from(address)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Composite (slot, seq) key for pending assemblies. Under UNTO-2630, seq is
 * strictly monotonic WITHIN a slot -- an in-block delete followed by a
 * recreate reuses (never restarts) seq, so a same-slot recreation can never
 * collide with an older incomplete assembly's key. The collision this key
 * actually guards against is seq REUSE ACROSS LATER SLOTS: a fully-removed
 * account recreated in a later slot restarts its own seq numbering at 0, so
 * without the slot component an old incarnation's incomplete assembly at
 * seq N could merge with a different, later incarnation's pages that reuse
 * seq N in a different slot. See AccountVersionMark in account-replay.ts
 * for the full UNTO-2630 grounding.
 */
function pendingKey(slot: bigint, seq: bigint): string {
  return `${slot.toString()}:${seq.toString()}`;
}

/**
 * Newest (slot, seq) among an address's in-flight pending assemblies, or
 * undefined if there are none. `pending` only ever holds INCOMPLETE
 * assemblies -- a completed one is deleted from the map the moment its last
 * page arrives (see processUpdate) -- so this has no record of a completed
 * assembly's version. The newest pending entry is still the right bound to
 * check an incoming delete against here: it is the newest NON-delete state
 * this layer currently knows about for the address. Under UNTO-2630 (see
 * the comparison helper in account-replay.ts) this plain lexicographic
 * (slot, seq) bound is the only freshness check a delete needs -- there is
 * no separate persistent tombstone.
 *
 * UNTO-2632 P1 audit -- deliberately NOT given a persistent version floor
 * like AccountPageCache: AccountPageCache needed one because a stale reseed
 * arriving after an accepted delete could silently corrupt its DURABLE byte
 * buffer (a later delta would overlay onto revived stale bytes and emit
 * corrupted full data -- see its versionFloor doc). PageAssembler has no
 * equivalent durable state for a stale event to corrupt: `pending` only
 * ever holds transient, INCOMPLETE page buffers, and a completed
 * assembly's bytes leave immediately via processUpdate's return value --
 * there is no cached full-account buffer here for a later stale delta to
 * merge onto. Forgetting a completed assembly's version can only let a
 * subsequently-arriving stale/out-of-order event (a delete, most likely)
 * be accepted and returned to the caller instead of being rejected at this
 * layer; that is an ORDERING concern, and per this module's own design
 * (see the doc comment above) it is already the responsibility of the
 * caller's persistent per-address mark (AccountSeqTracker /
 * shouldEmitAccountState in account-replay.ts), not this transient,
 * per-key assembler.
 */
function newestPendingVersion(
  addressPending: Map<string, PendingUpdate> | undefined
): { slot: bigint; seq: bigint } | undefined {
  if (!addressPending) return undefined;
  let newest: { slot: bigint; seq: bigint } | undefined;
  for (const pending of addressPending.values()) {
    if (!newest || pending.slot > newest.slot || (pending.slot === newest.slot && pending.seq > newest.seq)) {
      newest = { slot: pending.slot, seq: pending.seq };
    }
  }
  return newest;
}

/**
 * Calculate expected page count from data size
 */
function calculatePageCount(dataSize: number): number {
  if (dataSize === 0) return 0;
  return Math.ceil(dataSize / PAGE_SIZE);
}

/**
 * Assembles multi-page account updates into complete account data.
 *
 * Usage:
 * ```typescript
 * const assembler = new PageAssembler();
 *
 * for await (const response of client.streamAccountUpdates(request)) {
 *   if (response.message.case === "update") {
 *     const assembled = assembler.processUpdate(address, response.message.value);
 *     if (assembled) {
 *       // Complete account data is ready
 *       console.log("Assembled account:", assembled);
 *     }
 *   }
 * }
 * ```
 */
export class PageAssembler {
  private readonly assemblyTimeout: number;
  private readonly maxPendingPerAddress: number;

  /**
   * Pending updates keyed by address (hex) -> "slot:seq" composite key ->
   * PendingUpdate. Keying by seq alone would let an old incarnation's
   * incomplete assembly merge with a later, unrelated incarnation's pages
   * that reuse the same seq -- seq restarts at 0 only when a fully-removed
   * account is recreated in a LATER slot (never on a same-slot in-block
   * recreate under UNTO-2630); see pendingKey().
   */
  private pending: Map<string, Map<string, PendingUpdate>> = new Map();

  constructor(options: PageAssemblerOptions = {}) {
    this.assemblyTimeout = options.assemblyTimeout ?? 30000;
    this.maxPendingPerAddress = options.maxPendingPerAddress ?? 10;
  }

  /**
   * Process an account update and return assembled account if complete.
   *
   * @param address - Account address bytes
   * @param update - Account update from streaming response
   * @returns Assembled account if all pages received, null otherwise
   */
  processUpdate(address: Uint8Array, update: AccountUpdate): AssembledAccount | null {
    const addressKey = addressToKey(address);

    // Handle delete updates immediately
    if (update.delete) {
      const slot = BigInt(update.slot.toString());
      const seq = BigInt(update.seq.toString());

      /* Reject a delete that is stale relative to a newer NON-delete
         assembly currently in flight for this address, BEFORE any
         mutation. See the comparison helper in account-replay.ts for the
         UNTO-2630 grounding: plain lexicographic (slot, seq), applied
         identically to deletes and non-delete updates -- there is no
         separate persistent tombstone. The newest pending assembly is the
         newest state this layer currently knows about for the address; a
         missing one means any delete is accepted. */
      const newestPending = newestPendingVersion(this.pending.get(addressKey));
      const isNewer =
        !newestPending || slot > newestPending.slot || (slot === newestPending.slot && seq > newestPending.seq);
      if (!isNewer) {
        return null;
      }

      // Delete doesn't need page assembly. Top-level seq (unlike meta.seq)
      // is always present, including under views that strip meta. An
      // accepted delete discards any pending assemblies for this address
      // so they can never merge with a later update that reuses the same
      // (slot, seq) key.
      this.pending.delete(addressKey);
      return {
        address,
        slot,
        seq,
        meta: update.meta!,
        data: new Uint8Array(0),
        isDelete: true,
      };
    }

    // Updates without meta are incomplete - we need meta to know data size
    if (!update.meta) {
      return null;
    }

    // Sourced from the top-level field (always present) rather than
    // meta.seq (stripped under DATA_ONLY/PUBKEY_ONLY views; META_ONLY
    // strips data, not meta).
    const seq = BigInt(update.seq.toString());
    const slot = BigInt(update.slot.toString());
    // Composite (slot, seq) key: seq alone is not a version key across
    // slots (see pendingKey()) -- a fully-removed account recreated in a
    // LATER slot restarts seq at 0, so pending assemblies must not collide
    // across that incarnation boundary even without observing the delete
    // itself (e.g. resumed streams). A same-slot in-block recreate cannot
    // cause this collision: under UNTO-2630 it reuses seq rather than
    // restarting it.
    const key = pendingKey(slot, seq);

    // Get or create pending updates for this address
    let addressPending = this.pending.get(addressKey);
    if (!addressPending) {
      addressPending = new Map();
      this.pending.set(addressKey, addressPending);
    }

    // Get or create pending update for this (slot, seq)
    let pendingUpdate = addressPending.get(key);
    if (!pendingUpdate) {
      const expectedPageCount = calculatePageCount(update.meta.dataSize);
      pendingUpdate = {
        slot,
        seq,
        meta: update.meta,
        pages: new Map(),
        expectedPageCount,
        receivedAt: Date.now(),
      };
      addressPending.set(key, pendingUpdate);

      // Enforce max pending limit per address
      this.evictOldPending(addressPending);
    }

    // Add page if present
    if (update.page) {
      pendingUpdate.pages.set(update.page.pageIdx, {
        pageIdx: update.page.pageIdx,
        pageData: update.page.pageData,
      });
    }

    // Check if all pages received
    if (pendingUpdate.pages.size >= pendingUpdate.expectedPageCount) {
      // Remove from pending
      addressPending.delete(key);
      if (addressPending.size === 0) {
        this.pending.delete(addressKey);
      }

      // Assemble data from pages
      const data = this.assemblePages(pendingUpdate);

      return {
        address,
        slot: pendingUpdate.slot,
        seq: pendingUpdate.seq,
        meta: pendingUpdate.meta,
        data,
        isDelete: false,
      };
    }

    return null;
  }

  /**
   * Assemble complete data from buffered pages
   */
  private assemblePages(pending: PendingUpdate): Uint8Array {
    const totalSize = pending.meta.dataSize;
    if (totalSize === 0 || pending.expectedPageCount === 0) {
      return new Uint8Array(0);
    }

    const result = new Uint8Array(totalSize);
    let offset = 0;

    // Assemble pages in order
    for (let i = 0; i < pending.expectedPageCount; i++) {
      const page = pending.pages.get(i);
      if (page) {
        result.set(page.pageData, offset);
        offset += page.pageData.length;
      }
    }

    return result;
  }

  /**
   * Evict old pending updates for an address if limit exceeded
   */
  private evictOldPending(addressPending: Map<string, PendingUpdate>): void {
    if (addressPending.size <= this.maxPendingPerAddress) {
      return;
    }

    // Find oldest entries to evict
    const entries = Array.from(addressPending.entries());
    entries.sort((a, b) => a[1].receivedAt - b[1].receivedAt);

    const toEvict = entries.length - this.maxPendingPerAddress;
    for (let i = 0; i < toEvict; i++) {
      addressPending.delete(entries[i][0]);
    }
  }

  /**
   * Clean up expired pending assemblies.
   * Call this periodically to prevent memory leaks.
   */
  cleanup(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [addressKey, addressPending] of this.pending.entries()) {
      for (const [key, pending] of addressPending.entries()) {
        if (now - pending.receivedAt > this.assemblyTimeout) {
          addressPending.delete(key);
          evicted++;
        }
      }

      if (addressPending.size === 0) {
        this.pending.delete(addressKey);
      }
    }

    return evicted;
  }

  /**
   * Get current pending count for debugging
   */
  getPendingCount(): number {
    let count = 0;
    for (const addressPending of this.pending.values()) {
      count += addressPending.size;
    }
    return count;
  }

  /**
   * Clear all pending assemblies
   */
  clear(): void {
    this.pending.clear();
  }
}
