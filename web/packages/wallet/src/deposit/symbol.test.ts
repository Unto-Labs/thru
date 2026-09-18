import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEPOSIT_SYMBOL,
  LEGACY_DEPOSIT_SYMBOL,
  createDepositConfig,
  getValidatedDepositDestination,
  normalizeDepositSymbol,
} from "./index";
import { DepositTarget, ThruNetwork } from "../protocol/postMessage";

/* The deposit token was renamed at the display layer only. Deployed config may
   still carry the old symbol; every destination built from it must say THRUSD. */
describe("deposit symbol normalization", () => {
  it("maps the legacy symbol and an absent symbol to THRUSD, and keeps others", () => {
    expect(normalizeDepositSymbol(LEGACY_DEPOSIT_SYMBOL)).toBe(DEFAULT_DEPOSIT_SYMBOL);
    expect(normalizeDepositSymbol(undefined)).toBe(DEFAULT_DEPOSIT_SYMBOL);
    expect(normalizeDepositSymbol("")).toBe(DEFAULT_DEPOSIT_SYMBOL);
    expect(normalizeDepositSymbol("OTHER")).toBe("OTHER");
  });

  it("accepts a previously prepared destination that still says CREDITS", () => {
    const expected = {
      network: ThruNetwork.Alphanet,
      depositTarget: DepositTarget.THRUSD,
      tokenAccountAddress: "ta_token_account",
      mintAddress: "ta_mint",
      tokenProgramAddress: "ta_token_program",
      symbol: "THRUSD",
      decimals: 6,
    };
    expect(
      getValidatedDepositDestination({ ...expected, symbol: "CREDITS" }, expected),
    ).toEqual(expected);
    expect(() =>
      getValidatedDepositDestination({ ...expected, symbol: "OTHER" }, expected),
    ).toThrow("no longer matches wallet config: symbol");
  });

  it("reports THRUSD for a target whose config still says CREDITS", () => {
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
    expect(target.symbol).toBe("THRUSD");
    expect(target.depositTarget).toBe("credits");
  });
});
