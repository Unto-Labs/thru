/**
 * Promise-based Thru Ledger signer: the `LedgerThruSigner` contract of plan
 * §4.1 on top of the DMK signer kit.
 *
 * ```ts
 * const signer = new ThruLedgerSigner({
 *   dmk,
 *   sessionId,
 *   transactionSigningScheme: thru.ctx.transactionSigningScheme,
 * });
 * const { publicKey } = await signer.getAddress("m/44'/8478'/0'/0'", { display: true });
 * const { signedTransaction } = await signer.signTransactionBody(path, body);
 * ```
 *
 * Every signature is verified strictly before it is returned (§11.2), and
 * every failure is a typed {@link ThruLedgerError}.
 */
import {
  type DeviceActionState,
  DeviceActionStatus,
  type DeviceManagementKit,
  type DeviceSessionId,
  type LoggerPublisherService,
} from '@ledgerhq/device-management-kit';
import { encodeAddress } from '@thru/sdk/helpers';
import { type TransactionSigningScheme } from '@thru/sdk';

import {
  assertLedgerSigningScheme,
  CancelledError,
  DeviceBusyError,
  ThruLedgerError,
  TransportError,
} from './errors';
import { type AppConfig, type EoaAuthKindInput } from './protocol/apdu';
import { computeBodyHashDisplay } from './protocol/display';
import { type LedgerPath, type LedgerPathInput, parseLedgerPath } from './protocol/path';
import { type TokenHint } from './protocol/token-hint';
import { DefaultSignerThru, type SignerThru, type ThruDeviceActionReturn } from './dmk/SignerThru';
import { type ProgressCallback, type SignatureOutput, type SignTransactionOutput } from './dmk/tasks';
import { toThruLedgerError } from './dmk/to-error';

export interface ThruLedgerSignerConfig {
  /** A DMK instance with at least one transport, and a connected session. */
  dmk: DeviceManagementKit;
  sessionId: DeviceSessionId;
  /**
   * The target network's outer-transaction signing scheme: pass
   * `thru.ctx.transactionSigningScheme` from your Thru client. Required:
   * signing is refused, before the device is contacted, unless this is
   * RFC-8032 (plan decision D11, spec §11.1). There is no default, so a
   * signer can never assume RFC-8032 on a Legacy network. `getAddress` and
   * `getAppConfig` do not sign and work regardless.
   */
  transactionSigningScheme: TransactionSigningScheme;
  /** Skip DMK's open-app flow (the caller guarantees the Thru app is open). */
  skipOpenApp?: boolean;
  logger?: LoggerPublisherService;
  /** `0x6901` retry policy (default {@link DEFAULT_BUSY_RETRY}). */
  busyRetry?: BusyRetryPolicy;
}

/**
 * How long to retry an operation the device answered with `0x6901`.
 *
 * The Ledger Rust SDK draws the status page after a review synchronously
 * (about 3 s) and answers every APDU that arrives meanwhile with `0x6901`
 * without passing it to the app (spec §5.2), so the operation had no effect
 * on the device and starting it again is safe. Delays double from
 * `initialDelayMs` up to `maxDelayMs`; after `budgetMs` the error is
 * {@link DeviceBusyError}.
 */
export interface BusyRetryPolicy {
  readonly budgetMs: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_BUSY_RETRY: BusyRetryPolicy = Object.freeze({
  budgetMs: 5_000,
  initialDelayMs: 100,
  maxDelayMs: 500,
});

/** Whether `e` (or an error it wraps) is the SDK's `0x6901` answer. */
export function isDeviceBusy(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && typeof cur === 'object' && cur !== null; depth++) {
    if (cur instanceof DeviceBusyError) return true;
    const err = cur as { statusWord?: unknown; errorCode?: unknown; originalError?: unknown; cause?: unknown };
    if (err.statusWord === 0x6901) return true;
    if (typeof err.errorCode === 'string' && err.errorCode.toLowerCase() === '6901') return true;
    cur = err.originalError ?? err.cause;
  }
  return false;
}

/**
 * Run `attempt` and start it again while it fails with `0x6901`, within
 * `policy`. Abort and every other error end the loop at once.
 */
export async function retryWhileBusy<T>(
  attempt: () => Promise<T>,
  policy: BusyRetryPolicy = DEFAULT_BUSY_RETRY,
  signal?: AbortSignal,
): Promise<T> {
  const started = Date.now();
  let delay = policy.initialDelayMs;
  for (;;) {
    try {
      return await attempt();
    } catch (e) {
      if (!isDeviceBusy(e)) throw e;
      const elapsed = Date.now() - started;
      if (elapsed >= policy.budgetMs || signal?.aborted === true) {
        throw e instanceof DeviceBusyError ? e : new DeviceBusyError({ cause: e });
      }
      await new Promise((r) => setTimeout(r, Math.min(delay, policy.budgetMs - elapsed)));
      delay = Math.min(delay * 2, policy.maxDelayMs);
    }
  }
}

export interface OperationOptions {
  /** Called with DMK's `requiredUserInteraction` whenever it changes (for example `"sign-transaction"`). */
  onInteraction?: (interaction: string) => void;
  /** Abort the device action; the promise rejects with {@link CancelledError}. */
  signal?: AbortSignal;
}

export interface StreamOperationOptions extends OperationOptions {
  /** Called after every streamed data chunk (a 32 KiB body is about 130 APDUs). */
  onProgress?: ProgressCallback;
}

export interface SignMessageLedgerOptions extends StreamOperationOptions {
  /**
   * The 32-byte key the caller expects for `path`. If the connected device
   * holds a different key, `signMessage` fails with `KeyMismatchError`
   * before the device prompt.
   */
  expectedPublicKey?: Uint8Array;
}

export interface SignTransactionBodyOptions extends StreamOperationOptions {
  /**
   * For a token transfer: the mint and the recipient owner (and the account
   * seeds, if not the wallet default). Checked against the body first; the
   * device then shows the account owners and the mint instead of the token
   * accounts (`specs/ledger/app-thru-apdu.md` §7.2.1).
   */
  tokenHint?: TokenHint;
}

export interface LedgerAddress {
  readonly publicKey: Uint8Array;
  /** The `ta…` address. */
  readonly address: string;
  readonly path: LedgerPath;
}

export interface SignTransactionBodyResult extends SignTransactionOutput {
  /** The device's "Transaction hash" (lowercase hex SHA-256 of the body). */
  readonly bodyHash: string;
}

/** Turn a DMK device-action observable into a promise with typed errors. */
export function runDeviceAction<Output>(
  action: ThruDeviceActionReturn<Output>,
  options: OperationOptions = {},
): Promise<Output> {
  return new Promise<Output>((resolve, reject) => {
    let settled = false;
    let lastInteraction: string | undefined;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = (): void => {
      action.cancel();
      finish(() => reject(new CancelledError()));
    };
    if (options.signal?.aborted === true) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    action.observable.subscribe({
      next: (state: DeviceActionState<Output, unknown, { requiredUserInteraction: string }>) => {
        switch (state.status) {
          case DeviceActionStatus.Pending: {
            const interaction = state.intermediateValue.requiredUserInteraction;
            if (interaction !== lastInteraction) {
              lastInteraction = interaction;
              options.onInteraction?.(interaction);
            }
            break;
          }
          case DeviceActionStatus.Completed:
            finish(() => resolve(state.output));
            break;
          case DeviceActionStatus.Error:
            finish(() => reject(toThruLedgerError(state.error)));
            break;
          case DeviceActionStatus.Stopped:
            finish(() => reject(new CancelledError()));
            break;
          default:
            break;
        }
      },
      error: (e: unknown) => finish(() => reject(toThruLedgerError(e))),
      complete: () => finish(() => reject(new TransportError('device action ended without a result'))),
    });
  });
}

export class ThruLedgerSigner {
  readonly #signer: SignerThru;
  readonly #scheme: TransactionSigningScheme;
  readonly #skipOpenApp: boolean;
  readonly #logger: LoggerPublisherService | undefined;
  readonly #busyRetry: BusyRetryPolicy;

  constructor(config: ThruLedgerSignerConfig) {
    this.#scheme = config.transactionSigningScheme;
    this.#signer = new DefaultSignerThru({
      dmk: config.dmk,
      sessionId: config.sessionId,
      transactionSigningScheme: this.#scheme,
    });
    this.#skipOpenApp = config.skipOpenApp ?? false;
    this.#logger = config.logger;
    this.#busyRetry = config.busyRetry ?? DEFAULT_BUSY_RETRY;
  }

  /**
   * Run one device action, created afresh for every attempt, retrying the
   * whole operation from its first APDU while the device answers `0x6901`.
   */
  #run<Output>(make: () => ThruDeviceActionReturn<Output>, options: OperationOptions): Promise<Output> {
    return retryWhileBusy(() => runDeviceAction(make(), options), this.#busyRetry, options.signal);
  }

  /** The underlying DMK-style signer (observable API). */
  get dmkSigner(): SignerThru {
    return this.#signer;
  }

  #actionOptions(): { skipOpenApp: boolean; logger?: LoggerPublisherService } {
    return { skipOpenApp: this.#skipOpenApp, logger: this.#logger };
  }

  /** D11: refuse before contacting the device (also when no scheme was given). */
  #assertSigningScheme(): void {
    assertLedgerSigningScheme(this.#scheme);
  }

  /**
   * Derive the public key for `path`. With `display: true` the device shows
   * the `ta…` address and path and waits for the user to confirm.
   */
  async getAddress(path: LedgerPathInput, options: OperationOptions & { display?: boolean } = {}): Promise<LedgerAddress> {
    const parsed = parseLedgerPath(path);
    const publicKey = await this.#run(
      () => this.#signer.getAddress(parsed, { ...this.#actionOptions(), display: options.display ?? false }),
      options,
    );
    return { publicKey, address: encodeAddress(publicKey), path: parsed };
  }

  /** App version, blind-signing flag (advisory) and APDU protocol version. */
  getAppConfig(options: OperationOptions = {}): Promise<AppConfig> {
    return this.#run(() => this.#signer.getAppConfig(this.#actionOptions()), options);
  }

  /**
   * Stream `body` (wire bytes without the signature) to SIGN_TXN. The result
   * is verified strictly with `attachTransactionSignature` against the
   * body's fee payer; `signedTransaction` is ready to submit.
   */
  async signTransactionBody(
    path: LedgerPathInput,
    body: Uint8Array,
    options: SignTransactionBodyOptions = {},
  ): Promise<SignTransactionBodyResult> {
    this.#assertSigningScheme();
    const snapshot = new Uint8Array(body);
    const out = await this.#run(
      () => this.#signer.signTransaction(parseLedgerPath(path), snapshot, {
        ...this.#actionOptions(),
        tokenHint: options.tokenHint,
        onProgress: options.onProgress,
      }),
      options,
    );
    return { ...out, bodyHash: computeBodyHashDisplay(snapshot) };
  }

  /** Two-pass SIGN_MESSAGE over `"tn_msg_sign_v1__" ‖ message` (1..32768 bytes). */
  signMessage(path: LedgerPathInput, message: Uint8Array, options: SignMessageLedgerOptions = {}): Promise<SignatureOutput> {
    return this.#guard(() => {
      /* Copy once: every busy retry must sign the bytes of the original call. */
      const parsed = parseLedgerPath(path);
      const snapshot = new Uint8Array(message);
      const expectedPublicKey = options.expectedPublicKey === undefined ? undefined : new Uint8Array(options.expectedPublicKey);
      return this.#run(
        () => this.#signer.signMessage(parsed, snapshot, {
          ...this.#actionOptions(),
          expectedPublicKey,
          onProgress: options.onProgress,
        }),
        options,
      );
    });
  }

  /**
   * Clear-signed EOA create/delete authorization (82-byte M). `account` must
   * be the Ledger key for `path`.
   */
  signEoaAuth(
    path: LedgerPathInput,
    kind: EoaAuthKindInput,
    chainId: number,
    feePayer: Uint8Array,
    account: Uint8Array,
    options: OperationOptions = {},
  ): Promise<SignatureOutput> {
    return this.#guard(() => {
      /* Copy once: every busy retry must sign the inputs of the original call. */
      const parsed = parseLedgerPath(path);
      const feePayerKey = new Uint8Array(feePayer);
      const accountKey = new Uint8Array(account);
      return this.#run(
        () => this.#signer.signEoaAuth(parsed, kind, chainId, feePayerKey, accountKey, this.#actionOptions()),
        options,
      );
    });
  }

  async #guard<T>(fn: () => Promise<T>): Promise<T> {
    this.#assertSigningScheme();
    try {
      return await fn();
    } catch (e) {
      throw e instanceof ThruLedgerError ? e : toThruLedgerError(e);
    }
  }
}
