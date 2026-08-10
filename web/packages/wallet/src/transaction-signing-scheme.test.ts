import { describe, expect, it } from "vitest";

import {
  TransactionSigningScheme,
  withTransactionSigningScheme,
} from "./transaction-signing-scheme";

describe("withTransactionSigningScheme", () => {
  it("preserves the URL when no scheme is configured", () => {
    const url = "https://app.tid.sh/embedded?existing=1";
    expect(withTransactionSigningScheme(url)).toBe(url);
  });

  it("adds legacy mode without dropping existing parameters", () => {
    const result = new URL(
      withTransactionSigningScheme(
        "https://app.tid.sh/embedded?existing=1",
        TransactionSigningScheme.Legacy,
      ),
    );
    expect(result.searchParams.get("existing")).toBe("1");
    expect(result.searchParams.get("tn_transaction_signing_scheme")).toBe(
      "legacy",
    );
  });

  it("rejects invalid runtime values", () => {
    expect(() =>
      withTransactionSigningScheme(
        "https://app.tid.sh/embedded",
        "future" as TransactionSigningScheme,
      ),
    ).toThrow("Invalid transaction signing scheme: future");
  });
});
