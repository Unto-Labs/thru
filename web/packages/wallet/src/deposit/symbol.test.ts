import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEPOSIT_SYMBOL,
  LEGACY_DEPOSIT_SYMBOL,
  createDepositConfig,
  getValidatedDepositDestination,
  normalizeDepositSymbol,
  formatTokenAmountLabel,
} from "./index";
import { DepositTarget, ThruNetwork } from "../protocol/postMessage";

/* The deposit token was renamed at the display layer only. Deployed config may
   still carry the old symbol; every destination built from it must say $. */
describe("deposit symbol normalization", () => {
  it("prefixes dollar amounts while preserving signs, precision, and other tokens", () => {
    expect(formatTokenAmountLabel("1,250.00", "THRUSD")).toBe("$1,250.00");
    expect(formatTokenAmountLabel("+25.00", "$")).toBe("+$25.00");
    expect(formatTokenAmountLabel("-0.50", "ThruUSD")).toBe("-$0.50");
    expect(formatTokenAmountLabel("<0.000001", "$")).toBe("<$0.000001");
    expect(formatTokenAmountLabel("2.5", "THRU")).toBe("2.5 THRU");
  });
  it("maps the legacy symbol and an absent symbol to $, and keeps others", () => {
    expect(normalizeDepositSymbol(LEGACY_DEPOSIT_SYMBOL)).toBe(DEFAULT_DEPOSIT_SYMBOL);
    expect(normalizeDepositSymbol(undefined)).toBe(DEFAULT_DEPOSIT_SYMBOL);
    expect(normalizeDepositSymbol("")).toBe(DEFAULT_DEPOSIT_SYMBOL);
    for (const legacy of ["THRUSD", "ThruUSD", "Thru USD", "thrusd", "$"]) {
      expect(normalizeDepositSymbol(legacy)).toBe("$");
    }
    expect(normalizeDepositSymbol("OTHER")).toBe("OTHER");
  });

  it("accepts a previously prepared destination that still says CREDITS", () => {
    const expected = {
      network: ThruNetwork.Alphanet,
      depositTarget: DepositTarget.THRUSD,
      tokenAccountAddress: "ta_token_account",
      mintAddress: "ta_mint",
      tokenProgramAddress: "ta_token_program",
      symbol: "$",
      decimals: 6,
    };
    expect(
      getValidatedDepositDestination({ ...expected, symbol: "CREDITS" }, expected),
    ).toEqual(expected);
    for (const legacy of ["CREDITS", "THRUSD", "ThruUSD", "Thru USD"]) {
      const snapshot = { ...expected, symbol: legacy };
      expect(getValidatedDepositDestination(snapshot, snapshot)).toEqual(expected);
      expect(getValidatedDepositDestination(expected, snapshot)).toEqual(expected);
      expect(snapshot.symbol).toBe(legacy);
    }
    expect(() =>
      getValidatedDepositDestination({ ...expected, symbol: "OTHER" }, expected),
    ).toThrow("no longer matches wallet config: symbol");
  });

  it("reports $ for a target whose config still says CREDITS", () => {
    const config = createDepositConfig({
      defaultNetwork: "alphanet",
      networkConfigJson: JSON.stringify({
        alphanet: {
          rpc_url: "https://rpc.alphanet.example",
          default_deposit_target: "credits",
          providers: { coinbase: { orders_enabled: true } },
          targets: {
            credits: {
              mint_address: "ta_mint",
              token_program_address: "ta_token_program",
              symbol: "CREDITS",
              decimals: 6,
            },
          },
        },
      }),
    });
    const target = config.getTarget("alphanet", "credits");
    expect(target.symbol).toBe("$");
    expect(target.depositTarget).toBe("credits");
  });
});
