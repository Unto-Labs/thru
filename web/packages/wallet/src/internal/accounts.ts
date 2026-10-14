import { AccountView, CompressionError, consensus } from "@thru/sdk";
import type { Thru } from "@thru/sdk/client";

export interface ArchivedAccountState {
  status: "COMPRESSED";
  /** Decimal slot; safe to send over the embedded wallet bridge. */
  retrySlot?: string;
}

export function isAccountNotFound(error: unknown): boolean {
  return (
    !!error && typeof error === "object" && "code" in error && error.code === 5
  );
}

/** Read-only: an archived balance/authority is useful, but is never a signing nonce. */
export async function readWalletAccount(
  thru: Pick<Thru, "accounts" | "compression">,
  address: string,
) {
  let missing: unknown;
  try {
    const account = await thru.accounts.get(address);
    if (account.meta?.flags?.isDeleted) {
      throw new CompressionError("MISSING_ACCOUNT", "Account was deleted", {
        address,
      });
    }
    if (!account.meta?.flags?.isCompressed) {
      return {
        account,
        compression: undefined as ArchivedAccountState | undefined,
      };
    }
    missing = Object.assign(new Error("Account not found"), { code: 5 });
  } catch (error) {
    if (!isAccountNotFound(error)) throw error;
    missing = error;
  }
  const [state] = await thru.compression.getAccountStatuses({
    accounts: [address],
  });
  if (state?.status === "DOES_NOT_EXIST") throw missing;
  if (state?.status === "ACTIVE") {
    const account = await thru.accounts.get(address);
    if (account.meta?.flags?.isDeleted || account.meta?.flags?.isCompressed) {
      throw new CompressionError(
        "RPC_ERROR",
        "Account state changed. Please retry.",
        { address },
      );
    }
    return { account, compression: undefined };
  }
  if (state?.status !== "COMPRESSED") {
    throw new CompressionError("RPC_ERROR", "Account status unavailable", {
      address,
    });
  }
  try {
    const account = await thru.accounts.get(address, {
      view: AccountView.FULL,
      versionContext: consensus.currentOrHistoricalVersionContext(),
    });
    if (account.meta?.flags?.isDeleted) {
      throw new CompressionError(
        "INVALID_IMAGE",
        "Archived account was deleted",
        { address },
      );
    }
    return {
      account,
      compression: {
        status: "COMPRESSED",
        ...(state.retrySlot === undefined
          ? {}
          : { retrySlot: state.retrySlot.toString() }),
      } as ArchivedAccountState,
    };
  } catch (cause) {
    // In particular, an archive lookup's NotFound is not a zero balance.
    throw new CompressionError(
      "RPC_ERROR",
      "Archived account could not be read. Please retry.",
      { address, cause },
    );
  }
}
