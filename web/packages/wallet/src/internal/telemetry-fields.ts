import {
  POST_MESSAGE_REQUEST_TYPES,
  type PostMessageRequest,
} from '../protocol';
import type { TelemetryEventFields } from '../telemetry';

/** The only request/response fields safe to attach to telemetry events. */
export type SafeTelemetryFields = Pick<
  TelemetryEventFields,
  'walletAddress' | 'programAddress' | 'network' | 'transactionSignature'
>;

export function getSafeRequestTelemetryFields(
  request: PostMessageRequest,
): SafeTelemetryFields {
  const payload = request.payload as Record<string, unknown> | undefined;
  if (!payload) return {};

  const destination =
    payload.destination && typeof payload.destination === 'object'
      ? (payload.destination as Record<string, unknown>)
      : undefined;
  return {
    ...(typeof payload.walletAddress === 'string'
      ? { walletAddress: payload.walletAddress }
      : {}),
    ...(typeof payload.programAddress === 'string'
      ? { programAddress: payload.programAddress }
      : {}),
    ...(typeof payload.network === 'string'
      ? { network: payload.network }
      : typeof destination?.network === 'string'
        ? { network: destination.network }
        : {}),
  };
}

export function getSafeResponseTelemetryFields(
  requestType: string,
  result: unknown,
): SafeTelemetryFields {
  if (!result || typeof result !== 'object') return {};
  const value = result as Record<string, unknown>;
  const selectedAccount =
    value.selectedAccount && typeof value.selectedAccount === 'object'
      ? (value.selectedAccount as Record<string, unknown>)
      : value.account && typeof value.account === 'object'
        ? (value.account as Record<string, unknown>)
        : undefined;
  const session =
    value.session && typeof value.session === 'object'
      ? (value.session as Record<string, unknown>)
      : undefined;
  const walletAddress =
    typeof selectedAccount?.address === 'string'
      ? selectedAccount.address
      : typeof session?.walletAddress === 'string'
        ? session.walletAddress
        : undefined;
  const transactionSignature =
    (requestType === POST_MESSAGE_REQUEST_TYPES.CREATE_ACCOUNT ||
      requestType === POST_MESSAGE_REQUEST_TYPES.DEPOSIT) &&
    typeof value.signature === 'string'
      ? value.signature
      : undefined;

  return {
    ...(walletAddress ? { walletAddress } : {}),
    ...(transactionSignature ? { transactionSignature } : {}),
  };
}

/** Extract a telemetry-safe error code; callers supply their own fallback. */
export function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number'
    ? String(code)
    : undefined;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}
