import { afterEach, describe, expect, it, vi } from "vitest";
import { POST_MESSAGE_REQUEST_TYPES } from "../../protocol";
import { SigningSessionDescriptorStore } from "../../signing-sessions";
import { encodeAddress } from "@thru/sdk/helpers";
import { EmbeddedThruChain } from "./ThruChain";

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

describe("EmbeddedThruChain signing-session refresh", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the wallet when a retained signing session has expired locally", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://app.example" },
    });
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
    const show = vi.fn();
    const hide = vi.fn();
    const sendMessage = vi.fn(async () => ({
      result: { signedTransaction: "passkey_signed_transaction" },
    }));
    const chain = new EmbeddedThruChain(
      { sendMessage, show, hide } as never,
      { isConnected: () => false } as never,
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

    expect(show).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
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

  it("renews and broadcasts a signing session while disconnected", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://app.example" },
    });
    const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
    const walletAddress = encodeAddress(new Uint8Array(32).fill(10));
    const wireSession = {
      id: "session_refresh",
      walletAddress,
      publicKey: "thru_refresh_address",
      authIdx: -1,
      expiresAt: String(expiresAt),
      createdAt: String(expiresAt - 120),
    };
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (
        request.type ===
        POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION
      ) {
        return {
          result: {
            session: wireSession,
            programAddress: "thru_passkey_manager",
            instructionData: "AQID",
          },
        };
      }
      if (request.type === POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION) {
        return { result: { signedTransaction: "signed_refresh" } };
      }
      return {
        result: {
          session: { ...wireSession, authIdx: 2 },
        },
      };
    });
    const signingSessions = new SigningSessionDescriptorStore(
      new MemoryStorage(),
      "sessions",
    );
    await signingSessions.save({
      id: "session_current",
      walletAddress,
      publicKey: "thru_current_address",
      authIdx: 1,
      expiresAt: expiresAt - 60,
      createdAt: expiresAt - 600,
    });
    const broadcastTransaction = vi.fn(async () => "signature");
    const chain = new EmbeddedThruChain(
      { sendMessage } as never,
      { isConnected: () => false } as never,
      signingSessions,
      broadcastTransaction,
    );

    const renewed = await chain.renewSession({
      walletAddress,
      expiresAt,
    });
    expect(renewed).toEqual(
      expect.objectContaining({ id: "session_refresh", authIdx: 2 }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION,
        origin: "https://app.example",
        payload: {
          walletAddress,
          expiresAt: String(expiresAt),
          walletAccountIdx: 2,
        },
      }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: POST_MESSAGE_REQUEST_TYPES.SIGN_TRANSACTION,
        payload: expect.objectContaining({
          walletAddress,
          instructionData: "AQID",
          signingSessionId: "session_current",
        }),
      }),
    );
    expect(broadcastTransaction).toHaveBeenCalledWith("signed_refresh");
    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION,
        payload: { sessionId: "session_refresh" },
      }),
    );
  });

  it("auto-selects a matching session and retries once with passkey when its wallet key is missing", async () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example" } });
    const signingSessions = new SigningSessionDescriptorStore(
      new MemoryStorage(),
      "sessions",
    );
    await signingSessions.save({
      id: "session-active",
      walletAddress: "wallet-a",
      publicKey: "session-public-key",
      authIdx: 2,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      createdAt: Math.floor(Date.now() / 1000),
    });
    const show = vi.fn();
    const hide = vi.fn();
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Signing session key missing"), {
        code: "SIGNING_SESSION_UNAVAILABLE",
      }))
      .mockResolvedValueOnce({ result: { signedTransaction: "passkey-signed" } });
    const chain = new EmbeddedThruChain(
      { sendMessage, show, hide } as never,
      {
        isConnected: () => true,
        getSelectedAccount: () => ({ address: "wallet-a" }),
      } as never,
      signingSessions,
    );

    await expect(chain.signTransaction({
      programAddress: "program",
      instructionData: "AQID",
    })).resolves.toBe("passkey-signed");

    expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      payload: expect.objectContaining({ signingSessionId: "session-active" }),
    }));
    expect(sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      payload: expect.not.objectContaining({ signingSessionId: expect.anything() }),
    }));
    expect(show).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    await expect(chain.getSigningSession("session-active")).resolves.toBeNull();
  });
});
