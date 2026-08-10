/** Outer-transaction signature scheme used by transaction signing helpers. */
export enum TransactionSigningScheme {
    Rfc8032 = "rfc8032",
    Legacy = "legacy",
}

/** Resolve an optional scheme and reject invalid values from untyped callers. */
export function resolveTransactionSigningScheme(
    scheme?: TransactionSigningScheme,
): TransactionSigningScheme {
    if (scheme === undefined) {
        return TransactionSigningScheme.Rfc8032;
    }
    if (
        scheme !== TransactionSigningScheme.Rfc8032 &&
        scheme !== TransactionSigningScheme.Legacy
    ) {
        throw new Error(`Invalid transaction signing scheme: ${String(scheme)}`);
    }
    return scheme;
}
