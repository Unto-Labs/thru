import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorCode,
  EMBEDDED_PROVIDER_EVENTS,
  IFRAME_READY_EVENT,
  POST_MESSAGE_EVENT_TYPE,
  POST_MESSAGE_REQUEST_TYPES,
} from "../protocol";
import { NativeSDK } from "./NativeSDK";
import type { WebViewMessageEventLike } from "./provider/WebViewBridge";

class MockWebView {
  injected: string[] = [];
  injectJavaScript = (script: string): void => {
    this.injected.push(script);
  };
}

class MockStorage {
  values = new Map<string, string>();
  getItem = (key: string): string | null => this.values.get(key) ?? null;
  setItem = (key: string, value: string): void => {
    this.values.set(key, value);
  };
  removeItem = (key: string): void => {
    this.values.delete(key);
  };
}

function frameIdFor(sdk: NativeSDK): string {
  const frameId = new URL(sdk.getIframeSrc()).searchParams.get("tn_frame_id");
  if (!frameId) throw new Error("Missing frame id");
  return frameId;
}

function readyMessage(frameId: string): WebViewMessageEventLike {
  return {
    nativeEvent: {
      data: JSON.stringify({
        type: IFRAME_READY_EVENT,
        frameId,
        data: { ready: true },
      }),
    },
  };
}

function responseMessage(
  frameId: string,
  id: string,
  result: unknown,
): WebViewMessageEventLike {
  return {
    nativeEvent: {
      data: JSON.stringify({ id, frameId, success: true, result }),
    },
  };
}

function rejectedResponseMessage(
  frameId: string,
  id: string,
  code: ErrorCode,
  message: string,
): WebViewMessageEventLike {
  return {
    nativeEvent: {
      data: JSON.stringify({
        id,
        frameId,
        success: false,
        error: { code, message },
      }),
    },
  };
}

function eventMessage(
  frameId: string,
  event: string,
  data?: unknown,
): WebViewMessageEventLike {
  return {
    nativeEvent: {
      data: JSON.stringify({
        type: POST_MESSAGE_EVENT_TYPE,
        frameId,
        event,
        data,
      }),
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInjectedRequest(webView: MockWebView): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await flush();
    const script = webView.injected[0];
    if (script) return script;
    await wait(50);
  }
  throw new Error("Timed out waiting for injected request");
}

function parseInjectedRequest(script: string): {
  id: string;
  type: string;
  payload?: unknown;
  origin: string;
} {
  const match = script.match(/var msg = (.*?);\s*if \(window\.__pushIn\)/s);
  if (!match) throw new Error("Injected request not found");
  return JSON.parse(match[1]);
}

describe("NativeSDK", () => {
  let sdk: NativeSDK;
  let webView: MockWebView;

  beforeEach(() => {
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded",
      origin: "thru-mobile://token-dummy",
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);
  });

  afterEach(() => {
    sdk.destroy();
  });

  it("defaults iOS WebView mode to shell iframe", () => {
    expect(sdk.getIosWebViewMode()).toBe("shell-iframe");
  });

  it("can opt into direct iOS WebView mode", () => {
    const directSdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded",
      origin: "thru-mobile://token-dummy",
      iosWebViewMode: "direct",
    });
    expect(directSdk.getIosWebViewMode()).toBe("direct");
    directSdk.destroy();
  });

  it("defaults transparent wallet experience to the transparent native route", () => {
    const transparentSdk = new NativeSDK({
      walletExperience: "transparent",
      origin: "thru-mobile://token-dummy",
    });
    const iframeUrl = new URL(transparentSdk.getIframeSrc());

    expect(iframeUrl.origin).toBe("https://app.tid.sh");
    expect(iframeUrl.pathname).toBe("/embedded/native/transparent");

    transparentSdk.destroy();
  });

  it("requests a transparent focus surface for transparent connect", async () => {
    sdk.destroy();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded/native/transparent",
      walletExperience: "transparent",
      origin: "thru-mobile://token-dummy",
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);
    const onShowRequested = vi.fn();
    const onHideRequested = vi.fn();
    sdk.setUiHandlers({ onShowRequested, onHideRequested });

    const frameId = frameIdFor(sdk);
    const promise = sdk.signIn({
      app_id: "token_dummy_app",
      app_display_name: "Token Dummy App",
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    expect(onShowRequested).toHaveBeenCalledTimes(1);
    const request = parseInjectedRequest(await waitForInjectedRequest(webView));
    expect(request.type).toBe(POST_MESSAGE_REQUEST_TYPES.CONNECT);
    expect(request.payload).toEqual({
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
      },
    });

    const result = {
      accounts: [
        {
          accountType: "thru",
          address: "thru_test_address",
          label: "Account 1",
        },
      ],
      status: "completed",
    };
    sdk.onMessage(responseMessage(frameId, request.id, result));

    await expect(promise).resolves.toEqual({
      ...result,
      selectedAccount: result.accounts[0],
    });
    expect(onHideRequested).toHaveBeenCalledTimes(1);
  });

  it("sends transparent createAccount requests through the wallet WebView", async () => {
    sdk.destroy();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded/native/transparent",
      walletExperience: "transparent",
      origin: "thru-mobile://token-dummy",
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);
    const onShowRequested = vi.fn();
    const onHideRequested = vi.fn();
    const onConnect = vi.fn();
    sdk.setUiHandlers({ onShowRequested, onHideRequested });
    sdk.on("connect", onConnect);

    const frameId = frameIdFor(sdk);
    const promise = sdk.createAccount({
      accountName: "JCoin Account",
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "thru-mobile://token-dummy",
      },
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    expect(onShowRequested).toHaveBeenCalledTimes(1);
    const request = parseInjectedRequest(await waitForInjectedRequest(webView));
    expect(request.type).toBe(POST_MESSAGE_REQUEST_TYPES.CREATE_ACCOUNT);
    expect(request.payload).toEqual({
      accountName: "JCoin Account",
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "thru-mobile://token-dummy",
      },
    });

    const result = {
      account: {
        accountType: "thru",
        address: "thru_created_address",
        label: "JCoin Account",
      },
      accounts: [
        {
          accountType: "thru",
          address: "thru_created_address",
          label: "JCoin Account",
        },
      ],
      selectedAccount: {
        accountType: "thru",
        address: "thru_created_address",
        label: "JCoin Account",
      },
      signature: "thru_signature",
      vmError: "0",
      userErrorCode: "0",
      executionResult: "0",
    };
    sdk.onMessage(responseMessage(frameId, request.id, result));

    await expect(promise).resolves.toEqual(result);
    expect(onHideRequested).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenLastCalledWith({
      accounts: result.accounts,
      selectedAccount: result.selectedAccount,
      status: "completed",
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "thru-mobile://token-dummy",
      },
    });
  });

  it("persists a bundled transparent createAccount signing session", async () => {
    sdk.destroy();
    const storage = new MockStorage();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded/native/transparent",
      walletExperience: "transparent",
      origin: "thru-mobile://token-dummy",
      storage,
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);
    const nowSeconds = 1_800_000_000;

    const frameId = frameIdFor(sdk);
    const promise = sdk.createAccount({
      accountName: "JCoin Account",
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "thru-mobile://token-dummy",
      },
      createSigningSession: { expiresAt: nowSeconds + 120 },
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    const request = parseInjectedRequest(await waitForInjectedRequest(webView));
    expect(request.type).toBe(POST_MESSAGE_REQUEST_TYPES.CREATE_ACCOUNT);
    expect(request.payload).toEqual({
      accountName: "JCoin Account",
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "thru-mobile://token-dummy",
      },
      createSigningSession: {
        expiresAt: String(nowSeconds + 120),
      },
    });

    const result = {
      account: {
        accountType: "thru",
        address: "thru_created_address",
        label: "JCoin Account",
      },
      accounts: [
        {
          accountType: "thru",
          address: "thru_created_address",
          label: "JCoin Account",
        },
      ],
      selectedAccount: {
        accountType: "thru",
        address: "thru_created_address",
        label: "JCoin Account",
      },
      signature: "thru_signature",
      vmError: "0",
      userErrorCode: "0",
      executionResult: "0",
      signingSession: {
        id: "session_1",
        walletAddress: "thru_created_address",
        publicKey: "thru_session_address",
        authIdx: 1,
        expiresAt: String(nowSeconds + 120),
        createdAt: String(nowSeconds),
      },
    };
    sdk.onMessage(responseMessage(frameId, request.id, result));

    await expect(promise).resolves.toEqual(result);
    await expect(sdk.thru.getSigningSessions()).resolves.toEqual([
      expect.objectContaining({
        id: "session_1",
        walletAddress: "thru_created_address",
        publicKey: "thru_session_address",
        authIdx: 1,
        expiresAt: nowSeconds + 120,
        createdAt: nowSeconds,
      }),
    ]);
  });

  it("sends transparent passkey challenge signing requests through the wallet WebView", async () => {
    sdk.destroy();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded/native/transparent",
      walletExperience: "transparent",
      origin: "thru-mobile://token-dummy",
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);
    const onShowRequested = vi.fn();
    const onHideRequested = vi.fn();
    sdk.setUiHandlers({ onShowRequested, onHideRequested });

    const frameId = frameIdFor(sdk);
    const promise = sdk.thru.signPasskeyChallenge({
      challenge: "challenge_base64url",
      walletAddress: "thru_test_address",
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    expect(onShowRequested).toHaveBeenCalledTimes(1);
    const request = parseInjectedRequest(await waitForInjectedRequest(webView));
    expect(request.type).toBe(POST_MESSAGE_REQUEST_TYPES.SIGN_PASSKEY_CHALLENGE);
    expect(request.payload).toEqual({
      challenge: "challenge_base64url",
      walletAddress: "thru_test_address",
    });

    const result = {
      signatureR: "01",
      signatureS: "02",
      authenticatorData: "authenticator_data_base64",
      clientDataJSON: "client_data_json_base64",
    };
    sdk.onMessage(responseMessage(frameId, request.id, result));

    await expect(promise).resolves.toEqual(result);
    expect(onHideRequested).toHaveBeenCalledTimes(1);
  });

  it("maps signIn snake-case app metadata to wallet connect metadata", async () => {
    const frameId = frameIdFor(sdk);
    const promise = sdk.signIn({
      app_id: "token_dummy_app",
      app_display_name: "Token Dummy App",
      app_url: "https://token-dummy.thru.org",
      image_url: "https://token-dummy.thru.org/icon.png",
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    expect(webView.injected).toHaveLength(1);
    const request = parseInjectedRequest(webView.injected[0]);
    expect(request.type).toBe(POST_MESSAGE_REQUEST_TYPES.CONNECT);
    expect(request.origin).toBe("thru-mobile://token-dummy");
    expect(request.payload).toEqual({
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "https://token-dummy.thru.org",
        imageUrl: "https://token-dummy.thru.org/icon.png",
      },
    });

    const result = {
      accounts: [
        {
          accountType: "thru",
          address: "thru_test_address",
          label: "Account 1",
        },
      ],
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "https://token-dummy.thru.org",
        imageUrl: "https://token-dummy.thru.org/icon.png",
      },
    };
    sdk.onMessage(responseMessage(frameId, request.id, result));

    await expect(promise).resolves.toEqual({
      ...result,
      selectedAccount: result.accounts[0],
    });
  });

  it("opens a fresh connect request for account switching", async () => {
    const storage = new MockStorage();
    const selectedAccountStorageKey = "test-selected-account";
    const initialAccount = {
      accountType: "thru",
      address: "thru_test_address_1",
      label: "Account 1",
    };
    const switchedAccount = {
      accountType: "thru",
      address: "thru_test_address_2",
      label: "Account 2",
    };
    storage.setItem(
      selectedAccountStorageKey,
      JSON.stringify({
        version: 1,
        origin: "thru-mobile://token-dummy",
        walletOrigin: "http://localhost:3000",
        savedAt: new Date().toISOString(),
        selectedAccountAddress: initialAccount.address,
      }),
    );

    sdk.destroy();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded",
      origin: "thru-mobile://token-dummy",
      storage,
      selectedAccountStorageKey,
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);

    const frameId = frameIdFor(sdk);
    const connectPromise = sdk.signIn({
      app_id: "token_dummy_app",
      app_display_name: "Token Dummy App",
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    const connectRequest = parseInjectedRequest(webView.injected[0]);
    sdk.onMessage(
      responseMessage(frameId, connectRequest.id, {
        accounts: [initialAccount],
        selectedAccount: initialAccount,
        status: "completed",
      }),
    );
    await connectPromise;

    const switchPromise = sdk.signIn({
      app_id: "token_dummy_app",
      app_display_name: "Token Dummy App",
      intent: "switch-account",
    });
    await flush();

    expect(webView.injected).toHaveLength(2);
    const switchRequest = parseInjectedRequest(webView.injected[1]);
    expect(switchRequest.type).toBe(POST_MESSAGE_REQUEST_TYPES.CONNECT);
    expect(switchRequest.payload).toEqual({
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
      },
      intent: "switch-account",
    });

    const switchResult = {
      accounts: [initialAccount, switchedAccount],
      selectedAccount: switchedAccount,
      status: "completed",
    };
    sdk.onMessage(responseMessage(frameId, switchRequest.id, switchResult));

    await expect(switchPromise).resolves.toEqual({
      ...switchResult,
      accounts: [switchedAccount],
    });
    expect(sdk.getAccounts()).toEqual([switchedAccount]);
    expect(sdk.getSelectedAccount()).toEqual(switchedAccount);
  });

  it("does not persist or restore native connection snapshots", async () => {
    const storage = new MockStorage();
    const storageKey = "test-connection";
    const selectedAccountStorageKey = `${storageKey}.selected-account.v1`;
    sdk.destroy();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded",
      origin: "thru-mobile://token-dummy",
      storage,
      storageKey,
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);

    const frameId = frameIdFor(sdk);
    const promise = sdk.signIn({
      app_id: "token_dummy_app",
      app_display_name: "Token Dummy App",
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    const request = parseInjectedRequest(webView.injected[0]);
    const initialAccount = {
      accountType: "thru",
      address: "thru_test_address_1",
      label: "Account 1",
    };
    const selectedAccount = {
      accountType: "thru",
      address: "thru_test_address_2",
      label: "Account 2",
    };
    const result = {
      accounts: [initialAccount, selectedAccount],
      selectedAccount,
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "thru-mobile://token-dummy",
      },
      status: "completed",
    };
    sdk.onMessage(responseMessage(frameId, request.id, result));

    await expect(promise).resolves.toEqual({
      ...result,
      accounts: [selectedAccount],
    });
    expect(storage.values.has(storageKey)).toBe(false);
    const storedSelectedRaw =
      storage.values.get(selectedAccountStorageKey) ?? "{}";
    const storedSelected = JSON.parse(storedSelectedRaw);
    expect(storedSelected.selectedAccountAddress).toBe(selectedAccount.address);
    expect(storedSelected).not.toHaveProperty("result");
    expect(storedSelected).not.toHaveProperty("accounts");
    expect(storedSelectedRaw.toLowerCase()).not.toContain("passkey");

    const restored = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded",
      origin: "thru-mobile://token-dummy",
      storage,
      storageKey,
    });
    await expect(restored.restoreConnection()).resolves.toBeNull();
    expect(restored.isConnected()).toBe(false);
    expect(restored.getAccounts()).toEqual([]);
    expect(storage.values.has(storageKey)).toBe(false);
    restored.destroy();
  });

  it("opens account settings through the wallet WebView", async () => {
    const frameId = frameIdFor(sdk);
    const connectPromise = sdk.signIn({
      app_id: "token_dummy_app",
      app_display_name: "Token Dummy App",
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    const connectRequest = parseInjectedRequest(webView.injected[0]);
    const initialAccount = {
      accountType: "thru",
      address: "thru_test_address_1",
      label: "Account 1",
    };
    sdk.onMessage(
      responseMessage(frameId, connectRequest.id, {
        accounts: [initialAccount],
        status: "completed",
      }),
    );
    await connectPromise;

    const managedAccount = {
      accountType: "thru",
      address: "thru_test_address_2",
      label: "Account 2",
    };
    const managePromise = sdk.manageAccounts();
    await flush();

    expect(webView.injected).toHaveLength(2);
    const manageRequest = parseInjectedRequest(webView.injected[1]);
    expect(manageRequest.type).toBe(POST_MESSAGE_REQUEST_TYPES.MANAGE_ACCOUNTS);

    const manageResult = {
      accounts: [initialAccount, managedAccount],
      selectedAccount: managedAccount,
    };
    sdk.onMessage(responseMessage(frameId, manageRequest.id, manageResult));

    await expect(managePromise).resolves.toEqual({
      ...manageResult,
      accounts: [managedAccount],
    });
    expect(sdk.getAccounts()).toEqual([managedAccount]);
    expect(sdk.getSelectedAccount()).toEqual(managedAccount);
  });

  it("persists the selected account as an app-local preference", async () => {
    const storage = new MockStorage();
    const storageKey = "test-connection";
    const selectedAccountStorageKey = "test-selected-account";
    sdk.destroy();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded",
      origin: "thru-mobile://token-dummy",
      storage,
      storageKey,
      selectedAccountStorageKey,
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);

    const frameId = frameIdFor(sdk);
    const connectPromise = sdk.signIn({
      app_id: "token_dummy_app",
      app_display_name: "Token Dummy App",
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    const connectRequest = parseInjectedRequest(webView.injected[0]);
    const initialAccount = {
      accountType: "thru",
      address: "thru_test_address_1",
      label: "Account 1",
    };
    const selectedAccount = {
      accountType: "thru",
      address: "thru_test_address_2",
      label: "Account 2",
    };
    sdk.onMessage(
      responseMessage(frameId, connectRequest.id, {
        accounts: [initialAccount, selectedAccount],
        status: "completed",
      }),
    );
    await connectPromise;

    const selectPromise = sdk.selectAccount(selectedAccount.address);
    await flush();

    const selectRequest = parseInjectedRequest(webView.injected[1]);
    expect(selectRequest.type).toBe(POST_MESSAGE_REQUEST_TYPES.SELECT_ACCOUNT);
    sdk.onMessage(
      responseMessage(frameId, selectRequest.id, {
        account: selectedAccount,
      }),
    );

    await selectPromise;
    const storedSelected = JSON.parse(
      storage.values.get(selectedAccountStorageKey) ?? "{}",
    );
    expect(storedSelected.selectedAccountAddress).toBe(selectedAccount.address);
    expect(storage.values.has(storageKey)).toBe(false);
  });

  it("restores the app-local selected account on login", async () => {
    const storage = new MockStorage();
    const storageKey = "test-connection";
    const selectedAccountStorageKey = "test-selected-account";
    const initialAccount = {
      accountType: "thru",
      address: "thru_test_address_1",
      label: "Account 1",
    };
    const selectedAccount = {
      accountType: "thru",
      address: "thru_test_address_2",
      label: "Account 2",
    };
    storage.setItem(
      selectedAccountStorageKey,
      JSON.stringify({
        version: 1,
        origin: "thru-mobile://token-dummy",
        walletOrigin: "http://localhost:3000",
        savedAt: new Date().toISOString(),
        selectedAccountAddress: selectedAccount.address,
      }),
    );

    sdk.destroy();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded",
      origin: "thru-mobile://token-dummy",
      storage,
      storageKey,
      selectedAccountStorageKey,
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);

    const frameId = frameIdFor(sdk);
    const connectPromise = sdk.signIn({
      app_id: "token_dummy_app",
      app_display_name: "Token Dummy App",
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    const connectRequest = parseInjectedRequest(webView.injected[0]);
    expect(connectRequest.payload).toMatchObject({
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
      },
      preferredAccountAddress: selectedAccount.address,
    });
    const result = {
      accounts: [initialAccount, selectedAccount],
      selectedAccount,
      status: "completed",
    };
    sdk.onMessage(responseMessage(frameId, connectRequest.id, result));

    await expect(connectPromise).resolves.toEqual({
      ...result,
      accounts: [selectedAccount],
    });
    expect(sdk.getAccounts()).toEqual([selectedAccount]);
    expect(sdk.getSelectedAccount()).toEqual(selectedAccount);
    expect(sdk.getWalletAvailability()).toMatchObject({
      accounts: [selectedAccount],
      selectedAccount,
    });
  });

  it("clears legacy cached metadata without restoring a connection", async () => {
    const storage = new MockStorage();
    const storageKey = "test-connection";
    const result = {
      accounts: [
        {
          accountType: "thru",
          address: "thru_test_address",
          label: "Account 1",
        },
      ],
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "thru-mobile://token-dummy",
      },
      status: "completed",
    };

    storage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        origin: "thru-mobile://token-dummy",
        walletOrigin: "http://localhost:3000",
        savedAt: new Date().toISOString(),
        result,
      }),
    );

    sdk.destroy();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded",
      origin: "thru-mobile://token-dummy",
      storage,
      storageKey,
    });

    await expect(sdk.restoreConnection({ hydrate: false })).resolves.toBeNull();
    expect(sdk.isConnected()).toBe(false);
    expect(sdk.getAccounts()).toEqual([]);
    expect(storage.values.has(storageKey)).toBe(false);
  });

  it("syncs restored state against the wallet without opening a connect flow", async () => {
    const frameId = frameIdFor(sdk);
    const promise = sdk.syncConnectionState({
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
      },
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    const request = parseInjectedRequest(webView.injected[0]);
    expect(request.type).toBe(POST_MESSAGE_REQUEST_TYPES.GET_CONNECTION_STATE);
    expect(request.origin).toBe("thru-mobile://token-dummy");

    const state = {
      isAuthorized: true,
      isConnected: true,
      isUnlocked: false,
      hasPasskey: true,
      hasWalletAccount: true,
      accounts: [
        {
          accountType: "thru",
          address: "thru_test_address",
          label: "Account 1",
        },
      ],
      selectedAccount: {
        accountType: "thru",
        address: "thru_test_address",
        label: "Account 1",
      },
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "thru-mobile://token-dummy",
      },
    };
    sdk.onMessage(responseMessage(frameId, request.id, state));

    await expect(promise).resolves.toEqual(state);
    expect(sdk.isConnected()).toBe(true);
    expect(sdk.getAccounts()).toEqual(state.accounts);
  });

  it("reports wallet availability without hydrating unauthorized accounts", async () => {
    const availabilityEvents: unknown[] = [];
    sdk.on("availabilityChanged", (availability) => {
      availabilityEvents.push(availability);
    });

    const frameId = frameIdFor(sdk);
    const promise = sdk.refreshWalletAvailability({
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
      },
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    const request = parseInjectedRequest(webView.injected[0]);
    expect(request.type).toBe(POST_MESSAGE_REQUEST_TYPES.GET_CONNECTION_STATE);

    const state = {
      isAuthorized: false,
      isConnected: false,
      isUnlocked: false,
      hasPasskey: true,
      hasWalletAccount: true,
      accounts: [],
      selectedAccount: null,
      metadata: null,
    };
    sdk.onMessage(responseMessage(frameId, request.id, state));

    await expect(promise).resolves.toMatchObject({
      status: "ready",
      isAuthorized: false,
      hasPasskey: true,
      hasWalletAccount: true,
      accounts: [],
      selectedAccount: null,
      metadata: null,
    });
    expect(availabilityEvents).toHaveLength(1);
    expect(availabilityEvents[0]).toMatchObject({
      status: "ready",
      hasPasskey: true,
      hasWalletAccount: true,
    });
    expect(sdk.isConnected()).toBe(false);
    expect(sdk.getAccounts()).toEqual([]);
  });

  it("clears stale native state when the wallet has no active passkey session", async () => {
    const storage = new MockStorage();
    const storageKey = "test-connection";
    const staleResult = {
      accounts: [
        {
          accountType: "thru",
          address: "thru_test_address",
          label: "Account 1",
        },
      ],
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "thru-mobile://token-dummy",
      },
      status: "completed",
    };

    storage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        origin: "thru-mobile://token-dummy",
        walletOrigin: "http://localhost:3000",
        savedAt: new Date().toISOString(),
        result: staleResult,
      }),
    );

    sdk.destroy();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded",
      origin: "thru-mobile://token-dummy",
      storage,
      storageKey,
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);

    const frameId = frameIdFor(sdk);
    const promise = sdk.syncConnectionState({
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
      },
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    const request = parseInjectedRequest(webView.injected[0]);
    expect(request.type).toBe(POST_MESSAGE_REQUEST_TYPES.GET_CONNECTION_STATE);

    const state = {
      isAuthorized: true,
      isConnected: true,
      isUnlocked: false,
      hasPasskey: false,
      hasWalletAccount: true,
      accounts: staleResult.accounts,
      selectedAccount: staleResult.accounts[0],
      metadata: staleResult.metadata,
    };
    sdk.onMessage(responseMessage(frameId, request.id, state));

    await expect(promise).resolves.toEqual({
      ...state,
      accounts: [],
      selectedAccount: null,
    });
    expect(sdk.isConnected()).toBe(false);
    expect(sdk.getAccounts()).toEqual([]);
    expect(storage.values.has(storageKey)).toBe(false);
  });

  it("keeps legacy native session state cleared when sign-in consent is denied", async () => {
    const storage = new MockStorage();
    const storageKey = "test-connection";
    const restoredResult = {
      accounts: [
        {
          accountType: "thru",
          address: "thru_test_address",
          label: "Account 1",
        },
      ],
      metadata: {
        appId: "token_dummy_app",
        appName: "Token Dummy App",
        appUrl: "thru-mobile://token-dummy",
      },
      status: "completed",
    };

    storage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        origin: "thru-mobile://token-dummy",
        walletOrigin: "http://localhost:3000",
        savedAt: new Date().toISOString(),
        result: restoredResult,
      }),
    );

    sdk.destroy();
    sdk = new NativeSDK({
      walletUrl: "http://localhost:3000/embedded",
      origin: "thru-mobile://token-dummy",
      storage,
      storageKey,
    });
    webView = new MockWebView();
    sdk.attachWebView(webView);

    await expect(sdk.restoreConnection({ hydrate: false })).resolves.toBeNull();
    expect(storage.values.has(storageKey)).toBe(false);

    const frameId = frameIdFor(sdk);
    const promise = sdk.signIn({
      app_id: "token_dummy_app",
      app_display_name: "Token Dummy App",
    });

    sdk.onMessage(readyMessage(frameId));
    await flush();

    const request = parseInjectedRequest(webView.injected[0]);
    sdk.onMessage(
      rejectedResponseMessage(
        frameId,
        request.id,
        ErrorCode.USER_REJECTED,
        "User rejected the request",
      ),
    );

    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.USER_REJECTED,
    });
    expect(sdk.isConnected()).toBe(false);
    expect(sdk.getAccounts()).toEqual([]);
    expect(storage.values.has(storageKey)).toBe(false);
    await expect(sdk.restoreConnection({ hydrate: false })).resolves.toBeNull();
  });
});
