import { normalizeWalletAccountResult } from "../interfaces";
import type { GetConnectionStateResult } from "./postMessage";

export function normalizeConnectionStateResult(
  result: GetConnectionStateResult,
): GetConnectionStateResult {
  if (!result.isAuthorized || !result.hasPasskey) {
    return { ...result, accounts: [], selectedAccount: null };
  }

  return normalizeWalletAccountResult(result);
}
