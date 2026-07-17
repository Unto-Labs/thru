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

  it("sends a DEPOSIT request with the prepared destination and resolves the result", async () => {
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
    const surface: boolean[] = [];
    provider.onShowRequested = () => surface.push(true);
    provider.onHideRequested = () => surface.push(false);

    const result = await provider.deposit({
      destination: DESTINATION,
    });

    expect(captured).not.toBeNull();
    expect(captured!.type).toBe(POST_MESSAGE_REQUEST_TYPES.DEPOSIT);
    expect(captured!.origin).toBe(APP_ORIGIN);
    expect(captured!.payload).toEqual({
      destination: DESTINATION,
      network: ThruNetwork.Alphanet,
      resolvedDepositUiConfig: DEPOSIT_UI_CONFIG,
    });
    expect(result).toEqual({
      status: "completed",
      mintedAmountRaw: "1500000",
      signature: "ts_minttx",
    });
    expect(sendMessage).toHaveBeenCalledOnce();
    /* Surface shown before the flow, hidden after. */
    expect(surface[0]).toBe(true);
    expect(surface[surface.length - 1]).toBe(false);
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
        destination: DESTINATION,
      }),
    ).rejects.toThrow("wallet exploded");
    expect(hidden).toBe(true);
  });
});
