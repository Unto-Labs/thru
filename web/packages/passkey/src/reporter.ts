import { arrayBufferToBase64Url } from '@thru/programs/passkey-manager';

/** Original WebAuthn response, before wallet-specific signature conversion. */
export interface PasskeyCeremonyCredentialJson {
  id: string;
  rawId: string;
  type: 'public-key';
  authenticatorAttachment?: 'platform' | 'cross-platform';
  response:
    | {
        clientDataJSON: string;
        attestationObject: string;
        transports?: string[];
      }
    | { clientDataJSON: string; authenticatorData: string; signature: string };
}

export interface PasskeyCeremonyInfo {
  kind: 'get' | 'create';
  mode: 'inline' | 'popup';
  allowCredentials?: boolean;
}

/** Optional, per-call observer. Reuse it across the call's fallback chain.
 * Callbacks are isolated from authentication and never awaited. */
export interface PasskeyCeremonyReporter {
  started(info: PasskeyCeremonyInfo): void;
  finished(info: PasskeyCeremonyInfo & { credential?: PasskeyCeremonyCredentialJson }): void;
  failed(info: PasskeyCeremonyInfo & { error: unknown }): void;
}

export interface PasskeyReportingOptions {
  ceremonyReporter?: PasskeyCeremonyReporter;
  /** False prohibits popup routing even when explicitly requested. */
  allowPopupFallback?: boolean;
  /** Explicit popup mode must be invoked from a user interaction. */
  promptMode?: 'auto' | 'inline' | 'popup';
  /** Ask the browser to lead with "use a phone or tablet" (the hybrid QR)
   * instead of this device's passkeys, via the WebAuthn L3 `hints`. Browsers
   * that don't implement hints (Safari 26) show their usual picker. */
  preferHybrid?: boolean;
  signal?: AbortSignal;
}

export interface PasskeyCeremonyResult {
  credentialJson?: PasskeyCeremonyCredentialJson;
}

function safelyReport(callback: () => unknown): void {
  try {
    const result = callback();
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => {});
    }
  } catch {
    /* Observability must not change passkey behavior. */
  }
}

export async function reportPasskeyCeremony<T>(
  reporter: PasskeyCeremonyReporter | undefined,
  info: PasskeyCeremonyInfo,
  run: () => Promise<T>
): Promise<T> {
  if (reporter) safelyReport(() => reporter.started(info));
  try {
    const result = await run();
    if (reporter) {
      safelyReport(() =>
        reporter.finished({
          ...info,
          credential: (result as PasskeyCeremonyResult | null)?.credentialJson,
        })
      );
    }
    return result;
  } catch (error) {
    if (reporter) safelyReport(() => reporter.failed({ ...info, error }));
    throw error;
  }
}

/** Do not use credential.toJSON(): older Safari and extensions may not support it. */
export function serializePasskeyCredential(
  credential: PublicKeyCredential,
  kind: 'get' | 'create'
): PasskeyCeremonyCredentialJson | undefined {
  try {
    const response = credential.response;
    const attachment = credential.authenticatorAttachment;
    return {
      id: credential.id || arrayBufferToBase64Url(credential.rawId),
      rawId: arrayBufferToBase64Url(credential.rawId),
      type: 'public-key',
      ...(attachment === 'platform' || attachment === 'cross-platform'
        ? { authenticatorAttachment: attachment }
        : {}),
      response:
        kind === 'create'
          ? {
              clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
              attestationObject: arrayBufferToBase64Url(
                (response as AuthenticatorAttestationResponse).attestationObject
              ),
              transports: (response as AuthenticatorAttestationResponse).getTransports?.(),
            }
          : {
              clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
              authenticatorData: arrayBufferToBase64Url(
                (response as AuthenticatorAssertionResponse).authenticatorData
              ),
              signature: arrayBufferToBase64Url(
                (response as AuthenticatorAssertionResponse).signature
              ),
            },
    };
  } catch {
    return undefined;
  }
}
