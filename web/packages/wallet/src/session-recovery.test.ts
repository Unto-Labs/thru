import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddedThruChain } from "./provider/chains/ThruChain";
import { NativeThruChain } from "./native/provider/chains/ThruChain";
import {
  SigningSessionDescriptorStore,
  resolveSigningSessionStorageKey,
} from "./signing-sessions";
import { SecureStoreTestStorage } from "./test-utils/secure-store";

const origin = "https://app.example";
const intent = { programAddress: "program", instructionData: "AQID" };
const sessionError = (code: string) =>
  Object.assign(new Error("Signing session missing"), { code });

describe.each(["browser", "native"] as const)(
  "%s session recovery contract",
  (platform) => {
    beforeEach(() => vi.stubGlobal("window", { location: { origin } }));
    afterEach(() => vi.unstubAllGlobals());

    async function setup() {
      const storage = new SecureStoreTestStorage();
      const key = resolveSigningSessionStorageKey({
        walletOrigin: "https://wallet.example",
        appOrigin: origin,
      });
      const sessions = new SigningSessionDescriptorStore(storage, key);
      await sessions.save({
        id: "session-a",
        walletAddress: "wallet-a",
        publicKey: "public-a",
        authIdx: 2,
        createdAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });
      // Recreate the store, just as a redirect or native restart does.
      const restored = new SigningSessionDescriptorStore(storage, key);
      const sendMessage = vi
        .fn()
        .mockResolvedValue({ result: { signedTransaction: "signed" } });
      const show = vi.fn();
      const hide = vi.fn();
      const provider = {
        isConnected: () => true,
        isTransparent: () => false,
        getSelectedAccount: () => ({ address: "wallet-a" }),
        requestShow: show,
        requestHide: hide,
      };
      const chain =
        platform === "browser"
          ? new EmbeddedThruChain(
              { sendMessage, show, hide } as never,
              provider as never,
              restored,
            )
          : new NativeThruChain(
              { sendMessage } as never,
              provider as never,
              origin,
              restored,
            );
      return { chain, sessions: restored, sendMessage, show, hide, provider };
    }

    it("signs silently with a descriptor restored from storage", async () => {
      const { chain, sendMessage, show } = await setup();
      await expect(chain.signTransaction(intent)).resolves.toBe("signed");
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage.mock.calls[0][0].payload.signingSessionId).toBe(
        "session-a",
      );
      expect(show).not.toHaveBeenCalled();
    });

    it.each(["USER_REJECTED", "NETWORK_ERROR", "UNKNOWN_ERROR"])(
      "does not retry %s, even with session-like error text",
      async (code) => {
        const { chain, sessions, sendMessage, show } = await setup();
        const error = sessionError(code);
        sendMessage.mockRejectedValue(error);
        await expect(chain.signTransaction(intent)).rejects.toBe(error);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(show).not.toHaveBeenCalled();
        await expect(sessions.get("session-a")).resolves.not.toBeNull();
      },
    );

    it.each(["USER_REJECTED", "SIGNING_SESSION_UNAVAILABLE", "NETWORK_ERROR"])(
      "retries missing keys once, and stops if the retry returns %s",
      async (code) => {
        const { chain, sessions, sendMessage, show, hide } = await setup();
        const finalError = sessionError(code);
        sendMessage
          .mockRejectedValueOnce(sessionError("SIGNING_SESSION_UNAVAILABLE"))
          .mockRejectedValue(finalError);
        await expect(chain.signTransaction(intent)).rejects.toBe(finalError);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(
          sendMessage.mock.calls[1][0].payload.signingSessionId,
        ).toBeUndefined();
        expect(show).toHaveBeenCalledTimes(1);
        expect(hide).toHaveBeenCalledTimes(1);
        await expect(sessions.get("session-a")).resolves.toBeNull();
      },
    );

    it("does not select the previous account's session after switching accounts", async () => {
      const { chain, provider, sendMessage, show } = await setup();
      provider.getSelectedAccount = () => ({ address: "wallet-b" });
      await chain.signTransaction(intent);
      expect(
        sendMessage.mock.calls[0][0].payload.signingSessionId,
      ).toBeUndefined();
      expect(sendMessage.mock.calls[0][0].payload.walletAddress).toBe(
        "wallet-b",
      );
      expect(show).toHaveBeenCalledTimes(1);
    });
  },
);
