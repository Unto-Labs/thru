import { afterEach, describe, expect, it, vi } from "vitest";
import { POST_MESSAGE_REQUEST_TYPES } from "../../protocol";
import { SigningSessionDescriptorStore } from "../../signing-sessions";
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
    vi.unstubAllGlobals();
  });

  it("prepares and confirms a refresh while disconnected", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://app.example" },
    });
    const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
    const wireSession = {
      id: "session_refresh",
      walletAddress: "thru_test_address",
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
      return {
        result: {
          session: { ...wireSession, authIdx: 2 },
        },
      };
    });
    const chain = new EmbeddedThruChain(
      { sendMessage } as never,
      { isConnected: () => false } as never,
      new SigningSessionDescriptorStore(new MemoryStorage(), "sessions"),
    );

    const prepared = await chain.createSigningSessionInstruction({
      walletAddress: "thru_test_address",
      expiresAt,
      walletAccountIdx: 2,
    });
    expect(prepared).toEqual({
      session: expect.objectContaining({ id: "session_refresh", authIdx: -1 }),
      programAddress: "thru_passkey_manager",
      instructionData: new Uint8Array([1, 2, 3]),
    });

    const confirmed = await chain.confirmSigningSession("session_refresh");
    expect(confirmed).toEqual(
      expect.objectContaining({ id: "session_refresh", authIdx: 2 }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: POST_MESSAGE_REQUEST_TYPES.CREATE_SIGNING_SESSION_INSTRUCTION,
        origin: "https://app.example",
        payload: {
          walletAddress: "thru_test_address",
          expiresAt: String(expiresAt),
          walletAccountIdx: 2,
        },
      }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: POST_MESSAGE_REQUEST_TYPES.CONFIRM_SIGNING_SESSION,
        payload: { sessionId: "session_refresh" },
      }),
    );
  });
});
