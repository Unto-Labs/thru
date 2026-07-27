import { beforeEach, describe, expect, it, vi } from "vitest";

const { providerConfigs } = vi.hoisted(() => ({
  providerConfigs: [] as Array<{ iframeUrl?: string }>,
}));

vi.mock("./provider/EmbeddedProvider", () => ({
  EmbeddedProvider: class {
    constructor(config: { iframeUrl?: string }) {
      providerConfigs.push(config);
    }

    on(): void {}

    destroy(): void {}
  },
}));

import { BrowserSDK } from "./BrowserSDK";
import { TransactionSigningScheme } from "./transaction-signing-scheme";

beforeEach(() => {
  providerConfigs.length = 0;
});

describe("BrowserSDK transaction signing scheme", () => {
  it("propagates legacy mode to the hosted-wallet URL", () => {
    const sdk = new BrowserSDK({
      iframeUrl: "https://app.tid.sh/embedded?existing=1",
      signingSessionStorage: false,
      transactionSigningScheme: TransactionSigningScheme.Legacy,
    });

    const iframeUrl = new URL(providerConfigs[0]?.iframeUrl ?? "");
    expect(iframeUrl.searchParams.get("existing")).toBe("1");
    expect(
      iframeUrl.searchParams.get("tn_transaction_signing_scheme"),
    ).toBe("legacy");

    sdk.destroy();
  });
});
