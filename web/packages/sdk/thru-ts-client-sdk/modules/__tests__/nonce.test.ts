import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import {
  AccountUpdateSchema,
  StreamAccountUpdatesResponseSchema,
} from "@thru/sdk/proto";
import {
  createMockAccount,
  createMockAccountMeta,
  createMockContext,
  generateTestPubkey,
} from "../../__tests__/helpers/test-utils";
import { AccountNonceObserver, FeePayerNonceManager } from "../nonce";

describe("nonce", () => {
  it("refreshes and waits for streamed nonce updates", async () => {
    const ctx = createMockContext();
    const account = generateTestPubkey(0x11);
    vi.spyOn(ctx.query, "getAccount").mockResolvedValue(createMockAccount({
      address: { value: account },
      meta: { nonce: 5n },
    }));

    let publishUpdate!: () => void;
    const updateReady = new Promise<void>((resolve) => {
      publishUpdate = resolve;
    });

    vi.spyOn(ctx.streaming, "streamAccountUpdates").mockReturnValue(
      (async function* () {
        await updateReady;
        yield create(StreamAccountUpdatesResponseSchema, {
          message: {
            case: "update",
            value: create(AccountUpdateSchema, {
              slot: 42n,
              meta: createMockAccountMeta({ nonce: 7n }),
            }),
          },
        });
      })() as AsyncIterable<any>
    );

    const observer = new AccountNonceObserver(ctx, account);
    await expect(observer.refresh()).resolves.toBe(5n);

    const wait = observer.waitForNonceAtLeast(7n);
    publishUpdate();

    await expect(wait).resolves.toBe(7n);
    expect(observer.getLatestNonce()).toBe(7n);
    observer.close();
  });

  it("allocates sequential nonce ranges from current account state", async () => {
    const ctx = createMockContext();
    const account = generateTestPubkey(0x22);
    vi.spyOn(ctx.query, "getAccount").mockResolvedValue(createMockAccount({
      address: { value: account },
      meta: { nonce: 12n },
    }));

    const manager = new FeePayerNonceManager(ctx, account);
    await expect(manager.allocate(3)).resolves.toEqual({
      baseNonce: 12n,
      nonces: [12n, 13n, 14n],
      barrierNonce: 15n,
    });
    manager.close();
  });

  it("reserves local nonce ranges across allocations before chain state advances", async () => {
    const ctx = createMockContext();
    const account = generateTestPubkey(0x33);
    vi.spyOn(ctx.query, "getAccount").mockResolvedValue(createMockAccount({
      address: { value: account },
      meta: { nonce: 12n },
    }));

    const manager = new FeePayerNonceManager(ctx, account);
    const first = await manager.allocate(3);
    const second = await manager.allocate(2);

    expect(first.nonces).toEqual([12n, 13n, 14n]);
    expect(second.nonces).toEqual([15n, 16n]);
    expect(second.barrierNonce).toBe(17n);
    manager.close();
  });

  it("serializes concurrent local nonce allocations", async () => {
    const ctx = createMockContext();
    const account = generateTestPubkey(0x44);
    vi.spyOn(ctx.query, "getAccount").mockResolvedValue(createMockAccount({
      address: { value: account },
      meta: { nonce: 20n },
    }));

    const manager = new FeePayerNonceManager(ctx, account);
    const [first, second] = await Promise.all([
      manager.allocate(2),
      manager.allocate(2),
    ]);

    expect(first.nonces).toEqual([20n, 21n]);
    expect(second.nonces).toEqual([22n, 23n]);
    manager.close();
  });

  it("rejects nonce waiters when the stream ends unexpectedly", async () => {
    const ctx = createMockContext();
    const account = generateTestPubkey(0x55);
    vi.spyOn(ctx.query, "getAccount").mockResolvedValue(createMockAccount({
      address: { value: account },
      meta: { nonce: 5n },
    }));
    let endStream!: () => void;
    const streamDone = new Promise<void>((resolve) => {
      endStream = resolve;
    });
    vi.spyOn(ctx.streaming, "streamAccountUpdates").mockReturnValue(
      (async function* () {
        await streamDone;
      })() as AsyncIterable<any>
    );

    const observer = new AccountNonceObserver(ctx, account);
    const wait = observer.waitForNonceAtLeast(6n);
    await vi.waitFor(() => expect(ctx.query.getAccount).toHaveBeenCalled());
    endStream();

    await expect(wait).rejects.toThrow(/stream ended/i);
    observer.close();
  });
});
