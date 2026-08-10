import { afterEach, describe, expect, it, vi } from "vitest";
import { POST_MESSAGE_REQUEST_TYPES } from "../../../protocol";
import { SigningSessionDescriptorStore } from "../../../signing-sessions";
import { NativeThruChain } from "./ThruChain";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("NativeThruChain signing-session fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the wallet when a retained signing session has expired locally", async () => {
    const nowSeconds = 1_900_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(nowSeconds * 1_000);
    const signingSessions = new SigningSessionDescriptorStore(
      new MemoryStorage(),
      "sessions",
    );
    await signingSessions.save({
      id: "session_expiring",
      walletAddress: "thru_test_address",
      publicKey: "thru_session_address",
      authIdx: 2,
      expiresAt: nowSeconds + 60,
      createdAt: nowSeconds,
    });
    const requestShow = vi.fn(async () => {});
    const requestHide = vi.fn();
    const sendMessage = vi.fn(async () => ({
      result: { signedTransaction: "passkey_signed_transaction" },
    }));
    const chain = new NativeThruChain(
      { sendMessage } as never,
      {
        isConnected: () => false,
        isTransparent: () => true,
        requestShow,
        requestHide,
      } as never,
      "thru-mobile://token-dummy",
      signingSessions,
    );
    const retainedSession = await chain.getSigningSession("session_expiring");
    expect(retainedSession).not.toBeNull();

    nowSpy.mockReturnValue((nowSeconds + 61) * 1_000);
    await expect(
      retainedSession!.signTransaction({
        programAddress: "thru_program",
        instructionData: "AQID",
      }),
    ).resolves.toBe("passkey_signed_transaction");

    expect(requestShow).toHaveBeenCalledWith("sign-transaction-open");
    expect(requestHide).toHaveBeenCalledWith("sign-transaction-settled");
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
        payload: expect.objectContaining({
          walletAddress: "thru_test_address",
          signingSessionId: "session_expiring",
        }),
      }),
    );
  });
});
