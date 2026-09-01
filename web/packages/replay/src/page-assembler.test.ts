import { create } from "@bufbuild/protobuf";
import { describe, expect, test } from "vitest";
import {
  AccountMetaSchema,
  AccountPageSchema,
  AccountUpdateSchema,
  PubkeySchema,
  type AccountUpdate,
} from "@thru/sdk/proto";
import { PageAssembler, PAGE_SIZE } from "./page-assembler";

const ADDR = new Uint8Array([1, 2, 3]);
const OWNER = new Uint8Array([9]);

function makeDelta(options: {
  slot: bigint;
  seq: bigint;
  dataSize: number;
  pageIdx: number;
  fill: number;
}): AccountUpdate {
  return create(AccountUpdateSchema, {
    slot: options.slot,
    seq: options.seq,
    address: create(PubkeySchema, { value: ADDR }),
    meta: create(AccountMetaSchema, {
      owner: create(PubkeySchema, { value: OWNER }),
      seq: options.seq,
      dataSize: options.dataSize,
    }),
    page: create(AccountPageSchema, {
      pageIdx: options.pageIdx,
      pageSize: PAGE_SIZE,
      pageData: new Uint8Array(PAGE_SIZE).fill(options.fill),
    }),
  });
}

function makeDelete(slot: bigint, seq: bigint): AccountUpdate {
  return create(AccountUpdateSchema, {
    slot,
    seq,
    address: create(PubkeySchema, { value: ADDR }),
    delete: true,
    meta: create(AccountMetaSchema, {
      owner: create(PubkeySchema, { value: OWNER }),
      seq,
    }),
  });
}

describe("PageAssembler", () => {
  test("multi-page assembly completes once every page arrives", () => {
    const assembler = new PageAssembler();
    const dataSize = 2 * PAGE_SIZE;

    expect(
      assembler.processUpdate(ADDR, makeDelta({ slot: 1n, seq: 1n, dataSize, pageIdx: 0, fill: 1 }))
    ).toBeNull();
    const assembled = assembler.processUpdate(
      ADDR,
      makeDelta({ slot: 1n, seq: 1n, dataSize, pageIdx: 1, fill: 2 })
    );

    expect(assembled).not.toBeNull();
    expect(assembled?.isDelete).toBe(false);
    expect(assembled?.data[0]).toBe(1);
    expect(assembled?.data[PAGE_SIZE]).toBe(2);
  });

  test("delete returns immediately without needing page assembly", () => {
    const assembler = new PageAssembler();
    const result = assembler.processUpdate(ADDR, makeDelete(5n, 2n));

    expect(result).not.toBeNull();
    expect(result?.isDelete).toBe(true);
    expect(result?.slot).toBe(5n);
    expect(result?.seq).toBe(2n);
  });

  test("pending key: incomplete assemblies at (30,0) and (31,0) for the same address cannot merge", () => {
    const assembler = new PageAssembler();
    const dataSize = 2 * PAGE_SIZE;

    /* Two incomplete assemblies for the same address at the same seq (0)
       but different slots -- e.g. an account recreated in a LATER slot
       after a full removal restarts its own seq numbering at 0, the only
       case seq actually restarts under UNTO-2630 (a same-slot in-block
       recreate reuses seq instead; see pendingKey()). Each stays
       incomplete with only one page received. Without the slot component
       in the pending key, page 1 landing for slot 31 could complete slot
       30's assembly (or vice versa) using a page that belongs to an
       entirely different incarnation. */
    expect(
      assembler.processUpdate(ADDR, makeDelta({ slot: 30n, seq: 0n, dataSize, pageIdx: 0, fill: 0xaa }))
    ).toBeNull();
    expect(
      assembler.processUpdate(ADDR, makeDelta({ slot: 31n, seq: 0n, dataSize, pageIdx: 1, fill: 0xbb }))
    ).toBeNull();
    expect(assembler.getPendingCount()).toBe(2);

    /* Completing slot 30's assembly must only draw on slot 30's own page
       -- it must not pick up slot 31's page 1. */
    const completedSlot30 = assembler.processUpdate(
      ADDR,
      makeDelta({ slot: 30n, seq: 0n, dataSize, pageIdx: 1, fill: 0xcc })
    );
    expect(completedSlot30).not.toBeNull();
    expect(completedSlot30?.slot).toBe(30n);
    expect(completedSlot30?.seq).toBe(0n);
    expect(completedSlot30?.data[0]).toBe(0xaa);
    expect(completedSlot30?.data[PAGE_SIZE]).toBe(0xcc);
    expect(assembler.getPendingCount()).toBe(1);

    /* Slot 31's assembly is still pending, untouched by slot 30
       completing. */
    const completedSlot31 = assembler.processUpdate(
      ADDR,
      makeDelta({ slot: 31n, seq: 0n, dataSize, pageIdx: 0, fill: 0xdd })
    );
    expect(completedSlot31).not.toBeNull();
    expect(completedSlot31?.slot).toBe(31n);
    expect(completedSlot31?.seq).toBe(0n);
    expect(completedSlot31?.data[0]).toBe(0xdd);
    expect(completedSlot31?.data[PAGE_SIZE]).toBe(0xbb);
    expect(assembler.getPendingCount()).toBe(0);
  });

  test("delete clears every pending seq for the address, not just a matching one", () => {
    const assembler = new PageAssembler();
    const dataSize = 2 * PAGE_SIZE;

    assembler.processUpdate(ADDR, makeDelta({ slot: 10n, seq: 3n, dataSize, pageIdx: 0, fill: 1 }));
    assembler.processUpdate(ADDR, makeDelta({ slot: 10n, seq: 4n, dataSize, pageIdx: 0, fill: 2 }));
    expect(assembler.getPendingCount()).toBe(2);

    assembler.processUpdate(ADDR, makeDelete(10n, 5n));
    expect(assembler.getPendingCount()).toBe(0);
  });

  test("redelivered duplicate delete after a cross-slot recreate does not clear the recreated pending assembly", () => {
    const assembler = new PageAssembler();
    const dataSize = 2 * PAGE_SIZE;

    const deleteResult = assembler.processUpdate(ADDR, makeDelete(30n, 7n));
    expect(deleteResult?.isDelete).toBe(true);

    /* Recreated in a LATER slot: its own seq numbering restarts at 0 --
       the later-slot seq-restart class UNTO-2630 keeps (see
       AccountVersionMark in account-replay.ts). Only page 0 has arrived
       so far, so the assembly is still incomplete and pending. */
    expect(
      assembler.processUpdate(ADDR, makeDelta({ slot: 31n, seq: 0n, dataSize, pageIdx: 0, fill: 0xcc }))
    ).toBeNull();
    expect(assembler.getPendingCount()).toBe(1);

    /* A redelivered duplicate of the ORIGINAL delete (slot 30, seq 7)
       arrives after the recreate -- e.g. a replay/live-seam redelivery.
       It is older than the pending assembly's (31,0) mark under plain
       lexicographic comparison, so it is rejected and ignored entirely:
       no emission, and in particular it must NOT clear the recreated
       account's in-flight pending assembly. */
    const duplicate = assembler.processUpdate(ADDR, makeDelete(30n, 7n));
    expect(duplicate).toBeNull();
    expect(assembler.getPendingCount()).toBe(1);

    /* The recreated assembly still completes normally once its remaining
       page arrives. */
    const assembled = assembler.processUpdate(
      ADDR,
      makeDelta({ slot: 31n, seq: 0n, dataSize, pageIdx: 1, fill: 0xbb })
    );
    expect(assembled).not.toBeNull();
    expect(assembled?.slot).toBe(31n);
    expect(assembled?.seq).toBe(0n);
    expect(assembled?.data[0]).toBe(0xcc);
    expect(assembled?.data[PAGE_SIZE]).toBe(0xbb);
    expect(assembler.getPendingCount()).toBe(0);
  });

  test("a stale delete redelivered after a newer pending assembly is rejected", () => {
    const assembler = new PageAssembler();
    const dataSize = 2 * PAGE_SIZE;

    const deleteResult = assembler.processUpdate(ADDR, makeDelete(30n, 7n));
    expect(deleteResult?.isDelete).toBe(true);

    /* Recreated assembly pending at (31, 0): only page 0 has arrived so
       far. */
    expect(
      assembler.processUpdate(ADDR, makeDelta({ slot: 31n, seq: 0n, dataSize, pageIdx: 0, fill: 0xdd }))
    ).toBeNull();
    expect(assembler.getPendingCount()).toBe(1);

    /* delete(30,9) is newer than the original delete(30,7) but older than
       the pending assembly at (31,0) -- rejected against the pending
       mark, the only freshness bound a delete needs under UNTO-2630 (see
       the comparison helper in account-replay.ts). */
    const stale = assembler.processUpdate(ADDR, makeDelete(30n, 9n));
    expect(stale).toBeNull();
    expect(assembler.getPendingCount()).toBe(1);

    /* The pending assembly completes normally once its remaining page
       arrives, unaffected by the rejected delete. */
    const assembled = assembler.processUpdate(
      ADDR,
      makeDelta({ slot: 31n, seq: 0n, dataSize, pageIdx: 1, fill: 0xee })
    );
    expect(assembled).not.toBeNull();
    expect(assembled?.slot).toBe(31n);
    expect(assembled?.seq).toBe(0n);

    /* A genuinely newer delete is still accepted. */
    const finalDelete = assembler.processUpdate(ADDR, makeDelete(31n, 5n));
    expect(finalDelete?.isDelete).toBe(true);
  });

  test("delete(30,7) -> pending update(31,1) -> redelivered delete(30,9) is rejected against the pending mark; a duplicate of the original delete and a genuinely newer delete are handled the same way", () => {
    const assembler = new PageAssembler();
    const dataSize = 2 * PAGE_SIZE;

    const deleteResult = assembler.processUpdate(ADDR, makeDelete(30n, 7n));
    expect(deleteResult?.isDelete).toBe(true);

    /* update(31,1) starts a multi-page assembly; only page 0 has arrived
       so far, so it stays pending -- the newest state this layer
       currently knows about for the address. */
    expect(
      assembler.processUpdate(ADDR, makeDelta({ slot: 31n, seq: 1n, dataSize, pageIdx: 0, fill: 0x11 }))
    ).toBeNull();
    expect(assembler.getPendingCount()).toBe(1);

    /* A redelivered delete(30,9) is newer than the original delete(30,7)
       but older than the pending (31,1) assembly -- rejected. */
    expect(assembler.processUpdate(ADDR, makeDelete(30n, 9n))).toBeNull();
    expect(assembler.getPendingCount()).toBe(1);

    /* An exact duplicate of the original delete(30,7) is rejected the
       same way -- it is even older than (31,1). */
    expect(assembler.processUpdate(ADDR, makeDelete(30n, 7n))).toBeNull();
    expect(assembler.getPendingCount()).toBe(1);

    /* A genuinely newer delete, newer than the pending (31,1) assembly,
       still applies and clears it. */
    const finalDelete = assembler.processUpdate(ADDR, makeDelete(31n, 2n));
    expect(finalDelete?.isDelete).toBe(true);
    expect(assembler.getPendingCount()).toBe(0);
  });

  test("delete for one address never discards another address's pending assembly", () => {
    const assembler = new PageAssembler();
    const dataSize = 2 * PAGE_SIZE;
    const otherAddr = new Uint8Array([4, 5, 6]);

    assembler.processUpdate(ADDR, makeDelta({ slot: 10n, seq: 0n, dataSize, pageIdx: 0, fill: 1 }));
    assembler.processUpdate(
      otherAddr,
      create(AccountUpdateSchema, {
        slot: 10n,
        seq: 0n,
        address: create(PubkeySchema, { value: otherAddr }),
        meta: create(AccountMetaSchema, {
          owner: create(PubkeySchema, { value: OWNER }),
          seq: 0n,
          dataSize,
        }),
        page: create(AccountPageSchema, { pageIdx: 0, pageSize: PAGE_SIZE, pageData: new Uint8Array(PAGE_SIZE).fill(9) }),
      })
    );
    expect(assembler.getPendingCount()).toBe(2);

    assembler.processUpdate(ADDR, makeDelete(10n, 1n));
    expect(assembler.getPendingCount()).toBe(1);
  });
});
