import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeProvider } from "./NativeProvider";
import { WebViewBridge } from "./WebViewBridge";
import {
  DepositTarget,
  POST_MESSAGE_REQUEST_TYPES,
  ThruNetwork,
} from "../../protocol";
import type {
  DepositDestination,
  DepositUiConfig,
  PostMessageRequest,
} from "../../protocol";

/* RN mirror of provider/deposit-protocol.test.ts. The wallet WebView/iframe is
   never created because WebViewBridge.sendMessage is stubbed; we only assert the
   provider wires the DEPOSIT request and surfaces/hides the wallet around it. */

const WALLET_URL = "https://app.tid.sh/embedded/native";
const APP_ORIGIN = "thru-mobile://app";
const DESTINATION: DepositDestination = {
  network: ThruNetwork.Alphanet,
  depositTarget: DepositTarget.Credits,
  tokenAccountAddress: "ta_token_account",
  mintAddress: "ta_mint",
  tokenProgramAddress: "ta_token_program",
  symbol: "CREDITS",
  decimals: 6,
};
const DEPOSIT_UI_CONFIG: DepositUiConfig = {
  appearance: "dark",
  accentColor: "#0f766e",
  components: {
    button: { borderRadius: 8 },
  },
};

describe("native deposit protocol round-trip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a PREPARE_DEPOSIT request and resolves the destination", async () => {
    let captured: PostMessageRequest | null = null;
    vi.spyOn(WebViewBridge.prototype, "sendMessage").mockImplementation(
      async (request: PostMessageRequest) => {
        captured = request;
        return {
          id: request.id,
          success: true,
          result: DESTINATION,
        } as never;
      },
    );

    const provider = new NativeProvider({
      walletUrl: WALLET_URL,
      origin: APP_ORIGIN,
      network: ThruNetwork.Alphanet,
      depositUiConfig: DEPOSIT_UI_CONFIG,
    });
    const result = await provider.prepareDeposit(DepositTarget.Credits);

    expect(captured).not.toBeNull();
    expect(captured!.type).toBe(POST_MESSAGE_REQUEST_TYPES.PREPARE_DEPOSIT);
    expect(captured!.payload).toEqual({
      depositTarget: DepositTarget.Credits,
      network: ThruNetwork.Alphanet,
    });
    expect(result).toEqual(DESTINATION);
  });

  it("resolves a completed deposit, hides the surface, and preserves the wallet session", async () => {
    let captured: PostMessageRequest | null = null;
    const sendMessage = vi
      .spyOn(WebViewBridge.prototype, "sendMessage")
      .mockImplementation(async (request: PostMessageRequest) => {
        captured = request;
        return {
          id: request.id,
          success: true,
          result: {
            status: "completed",
            mintedAmountRaw: "1500000",
            signature: "ts_minttx",
          },
        } as never;
      });

    const provider = new NativeProvider({
      walletUrl: WALLET_URL,
      origin: APP_ORIGIN,
      network: ThruNetwork.Alphanet,
      depositUiConfig: DEPOSIT_UI_CONFIG,
    });
    const connectedAccount = {
      accountType: "thru" as const,
      address: "thru_connected",
      label: "Connected",
    };
    provider.hydrateConnection({
      accounts: [connectedAccount],
      selectedAccount: connectedAccount,
      status: "completed",
    });
    const surface: string[] = [];
    provider.onShowRequested = (reason) => surface.push(`show:${reason}`);
    provider.onHideRequested = (reason) => surface.push(`hide:${reason}`);

    const result = await provider.deposit({
      providerId: "unifold",
      destination: DESTINATION,
    });

    expect(captured).not.toBeNull();
    expect(captured!.type).toBe(POST_MESSAGE_REQUEST_TYPES.DEPOSIT);
    expect(captured!.origin).toBe(APP_ORIGIN);
    expect(captured!.payload).toEqual({
      providerId: "unifold",
      destination: DESTINATION,
      resolvedDepositUiConfig: DEPOSIT_UI_CONFIG,
    });
    expect(result).toEqual({
      status: "completed",
      mintedAmountRaw: "1500000",
      signature: "ts_minttx",
    });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(surface).toEqual(["show:deposit-open", "hide:deposit-settled"]);
    expect(provider.isConnected()).toBe(true);
    expect(provider.getSelectedAccount()).toEqual(connectedAccount);
  });

  it("cancels an explicit Coinbase deposit without resetting the wallet session", async () => {
    let captured: PostMessageRequest | null = null;
    vi.spyOn(WebViewBridge.prototype, "sendMessage").mockImplementation(
      async (request: PostMessageRequest) => {
        captured = request;
        return {
          id: request.id,
          success: true,
          result: { status: "cancelled" },
        } as never;
      },
    );

    const provider = new NativeProvider({
      walletUrl: WALLET_URL,
      origin: APP_ORIGIN,
      network: ThruNetwork.Alphanet,
      depositUiConfig: DEPOSIT_UI_CONFIG,
    });
    const connectedAccount = {
      accountType: "thru" as const,
      address: "thru_connected",
      label: "Connected",
    };
    provider.hydrateConnection({
      accounts: [connectedAccount],
      selectedAccount: connectedAccount,
      status: "completed",
    });
    const surface: boolean[] = [];
    provider.onShowRequested = () => surface.push(true);
    provider.onHideRequested = () => surface.push(false);

    const result = await provider.deposit({
      providerId: "coinbase",
      destination: DESTINATION,
      paymentAmount: "20.00",
    });

    expect(captured).not.toBeNull();
    expect(captured!.type).toBe(POST_MESSAGE_REQUEST_TYPES.DEPOSIT);
    expect(captured!.payload).toEqual({
      providerId: "coinbase",
      destination: DESTINATION,
      paymentAmount: "20.00",
      resolvedDepositUiConfig: DEPOSIT_UI_CONFIG,
    });
    expect(result).toEqual({ status: "cancelled" });
    expect(surface).toEqual([true, false]);
    expect(provider.isConnected()).toBe(true);
    expect(provider.getSelectedAccount()).toEqual(connectedAccount);
  });

  it("round-trips a cancelled result and hides the surface", async () => {
    vi.spyOn(WebViewBridge.prototype, "sendMessage").mockImplementation(
      async (request: PostMessageRequest) =>
        ({
          id: request.id,
          success: true,
          result: { status: "cancelled" },
        }) as never,
    );

    const provider = new NativeProvider({
      walletUrl: WALLET_URL,
      origin: APP_ORIGIN,
    });
    let hidden = false;
    provider.onHideRequested = () => {
      hidden = true;
    };

    const result = await provider.deposit({
      providerId: "unifold",
      destination: DESTINATION,
    });

    expect(result).toEqual({ status: "cancelled" });
    expect(hidden).toBe(true);
  });

  it("hides the surface and rejects when the wallet errors", async () => {
    vi.spyOn(WebViewBridge.prototype, "sendMessage").mockRejectedValue(
      new Error("wallet exploded"),
    );

    const provider = new NativeProvider({
      walletUrl: WALLET_URL,
      origin: APP_ORIGIN,
    });
    let hidden = false;
    provider.onHideRequested = () => {
      hidden = true;
    };

    await expect(
      provider.deposit({
        providerId: "unifold",
        destination: DESTINATION,
      }),
    ).rejects.toThrow("wallet exploded");
    expect(hidden).toBe(true);
  });

  it("keeps a transparent deposit surface visible while another request settles", async () => {
    const pending = new Map<
      string,
      (response: { id: string; success: true; result: unknown }) => void
    >();
    vi.spyOn(WebViewBridge.prototype, "sendMessage").mockImplementation(
      (request: PostMessageRequest) =>
        new Promise((resolve) => {
          pending.set(request.type, resolve as never);
        }),
    );

    const provider = new NativeProvider({
      walletUrl: WALLET_URL,
      origin: APP_ORIGIN,
      walletExperience: "transparent",
    });
    const surface: string[] = [];
    provider.onShowRequested = (reason) => surface.push(`show:${reason}`);
    provider.onHideRequested = (reason) => surface.push(`hide:${reason}`);

    const depositPromise = provider.deposit({
      providerId: "unifold",
      destination: DESTINATION,
    });
    const signingPromise = provider.thru.signPasskeyChallenge({
      challenge: "challenge_base64url",
      walletAddress: "thru_test_address",
    });

    await vi.waitFor(() => {
      expect(pending.has(POST_MESSAGE_REQUEST_TYPES.DEPOSIT)).toBe(true);
      expect(
        pending.has(POST_MESSAGE_REQUEST_TYPES.SIGN_PASSKEY_CHALLENGE),
      ).toBe(true);
    });

    pending.get(POST_MESSAGE_REQUEST_TYPES.SIGN_PASSKEY_CHALLENGE)?.({
      id: "sign-response",
      success: true,
      result: {
        signatureR: "01",
        signatureS: "02",
        authenticatorData: "authenticator_data_base64",
        clientDataJSON: "client_data_json_base64",
      },
    });
    await signingPromise;
    expect(surface).toEqual(["show:deposit-open"]);

    pending.get(POST_MESSAGE_REQUEST_TYPES.DEPOSIT)?.({
      id: "deposit-response",
      success: true,
      result: { status: "cancelled" },
    });
    await expect(depositPromise).resolves.toEqual({ status: "cancelled" });
    expect(surface).toEqual([
      "show:deposit-open",
      "hide:deposit-settled",
    ]);
  });

  it("does not let a stale disconnect clear or hide a newer connection", async () => {
    const pending = new Map<
      string,
      (response: { id: string; success: true; result: unknown }) => void
    >();
    vi.spyOn(WebViewBridge.prototype, "sendMessage").mockImplementation(
      (request: PostMessageRequest) =>
        new Promise((resolve) => {
          pending.set(request.type, resolve as never);
        }),
    );

    const provider = new NativeProvider({
      walletUrl: WALLET_URL,
      origin: APP_ORIGIN,
      walletExperience: "transparent",
    });
    const surface: string[] = [];
    provider.onShowRequested = (reason) => surface.push(`show:${reason}`);
    provider.onHideRequested = (reason) => surface.push(`hide:${reason}`);

    const originalAccount = {
      accountType: "thru" as const,
      address: "thru_original",
      label: "Original",
    };
    provider.hydrateConnection({
      accounts: [originalAccount],
      selectedAccount: originalAccount,
      status: "completed",
    });

    const disconnectPromise = provider.disconnect();
    await vi.waitFor(() => {
      expect(pending.has(POST_MESSAGE_REQUEST_TYPES.DISCONNECT)).toBe(true);
    });

    const newerAccount = {
      accountType: "thru" as const,
      address: "thru_newer",
      label: "Newer",
    };
    provider.hydrateConnection({
      accounts: [newerAccount],
      selectedAccount: newerAccount,
      status: "completed",
    });

    const depositPromise = provider.deposit({
      providerId: "unifold",
      destination: DESTINATION,
    });
    await vi.waitFor(() => {
      expect(pending.has(POST_MESSAGE_REQUEST_TYPES.DEPOSIT)).toBe(true);
    });
    pending.get(POST_MESSAGE_REQUEST_TYPES.DISCONNECT)?.({
      id: "disconnect-response",
      success: true,
      result: {},
    });
    await disconnectPromise;
    expect(provider.isConnected()).toBe(true);
    expect(provider.getSelectedAccount()).toEqual(newerAccount);
    expect(surface).toEqual(["show:deposit-open"]);

    pending.get(POST_MESSAGE_REQUEST_TYPES.DEPOSIT)?.({
      id: "deposit-response",
      success: true,
      result: { status: "cancelled" },
    });
    await expect(depositPromise).resolves.toEqual({ status: "cancelled" });
    expect(surface).toEqual([
      "show:deposit-open",
      "hide:deposit-settled",
    ]);
  });

  it("preserves the local connection when disconnect fails", async () => {
    vi.spyOn(WebViewBridge.prototype, "sendMessage").mockRejectedValue(
      new Error("Request timeout - wallet did not respond"),
    );

    const provider = new NativeProvider({
      walletUrl: WALLET_URL,
      origin: APP_ORIGIN,
      walletExperience: "transparent",
    });
    const account = {
      accountType: "thru" as const,
      address: "thru_connected",
      label: "Connected",
    };
    provider.hydrateConnection({
      accounts: [account],
      selectedAccount: account,
      status: "completed",
    });

    await expect(provider.disconnect()).rejects.toThrow(
      "Request timeout - wallet did not respond",
    );
    expect(provider.isConnected()).toBe(true);
    expect(provider.getSelectedAccount()).toEqual(account);
  });
});
