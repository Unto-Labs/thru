import { TransactionSigningScheme } from "@thru/sdk";

export { TransactionSigningScheme };

export const TRANSACTION_SIGNING_SCHEME_SEARCH_PARAM =
  "tn_transaction_signing_scheme";

function assertTransactionSigningScheme(
  scheme: TransactionSigningScheme,
): void {
  if (
    scheme !== TransactionSigningScheme.Rfc8032 &&
    scheme !== TransactionSigningScheme.Legacy
  ) {
    throw new Error(`Invalid transaction signing scheme: ${String(scheme)}`);
  }
}

/** Add an explicit transaction scheme to an embedded wallet URL. */
export function withTransactionSigningScheme(
  walletUrl: string,
  scheme?: TransactionSigningScheme,
): string {
  if (scheme === undefined) {
    return walletUrl;
  }
  assertTransactionSigningScheme(scheme);
  const url = new URL(walletUrl);
  url.searchParams.set(TRANSACTION_SIGNING_SCHEME_SEARCH_PARAM, scheme);
  return url.toString();
}
