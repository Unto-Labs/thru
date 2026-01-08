/**
 * Page Assembler for multi-page account updates.
 *
 * Large accounts are split into multiple AccountPage messages (4KB chunks).
 * This module buffers pages and emits complete account data when all pages
 * for a given sequence number are received.
 */

import type { AccountMeta, AccountPage } from "@thru/proto";
import type { AccountUpdate } from "@thru/proto";

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
   * Pending updates keyed by address (hex) -> seq (string) -> PendingUpdate
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
      // Delete doesn't need page assembly
      return {
        address,
        slot: BigInt(update.slot.toString()),
        seq: update.meta?.seq ? BigInt(update.meta.seq.toString()) : 0n,
        meta: update.meta!,
        data: new Uint8Array(0),
        isDelete: true,
      };
    }

    // Updates without meta are incomplete - we need meta to know data size
    if (!update.meta) {
      return null;
    }

    const seq = BigInt(update.meta.seq.toString());
    const seqKey = seq.toString();
    const slot = BigInt(update.slot.toString());

    // Get or create pending updates for this address
    let addressPending = this.pending.get(addressKey);
    if (!addressPending) {
      addressPending = new Map();
      this.pending.set(addressKey, addressPending);
    }

    // Get or create pending update for this sequence
    let pendingUpdate = addressPending.get(seqKey);
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
      addressPending.set(seqKey, pendingUpdate);

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
      addressPending.delete(seqKey);
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
      for (const [seqKey, pending] of addressPending.entries()) {
        if (now - pending.receivedAt > this.assemblyTimeout) {
          addressPending.delete(seqKey);
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
