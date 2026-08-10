import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface PluginConfig {
  ios?: {
    infoPlist?: Record<string, unknown> & {
      WKAppBoundDomains?: string[];
    };
  };
  android?: Record<string, unknown>;
  [key: string]: unknown;
}

const withThruWalletNative = require("../../../app.plugin.cjs") as (
  config: PluginConfig,
  options?: { rpDomain?: string },
) => PluginConfig;

describe("@thru/wallet native config plugin", () => {
  it("adds the wallet and Coinbase app-bound domains", () => {
    const config = withThruWalletNative({}, { rpDomain: "wallet.example.com" });

    expect(config.ios?.infoPlist?.WKAppBoundDomains).toEqual([
      "wallet.example.com",
      "coinbase.com",
    ]);
  });

  it("preserves existing domains without duplicating Coinbase", () => {
    const config = withThruWalletNative(
      {
        ios: {
          infoPlist: {
            WKAppBoundDomains: ["coinbase.com", "existing.example.com"],
          },
        },
      },
      { rpDomain: "wallet.example.com" },
    );

    expect(config.ios?.infoPlist?.WKAppBoundDomains).toEqual([
      "coinbase.com",
      "existing.example.com",
      "wallet.example.com",
    ]);
  });

  it("fails before exceeding WebKit's app-bound-domain limit", () => {
    const existingDomains = Array.from(
      { length: 9 },
      (_, index) => `domain-${index}.example.com`,
    );

    expect(() =>
      withThruWalletNative(
        { ios: { infoPlist: { WKAppBoundDomains: existingDomains } } },
        { rpDomain: "wallet.example.com" },
      ),
    ).toThrow(/capped at 10 entries/);
  });
});
