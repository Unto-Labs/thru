/**
 * DMK-style signer for the Thru app, following the device-sdk-ts signer-kit
 * shape (`SignerXxx` + `SignerXxxBuilder`, operations returning
 * `{ observable, cancel }`). Most integrators want the promise-based
 * {@link ThruLedgerSigner} instead.
 */
import {
  type DeviceActionIntermediateValue,
  DeviceActionStatus,
  type DeviceManagementKit,
  type DeviceSessionId,
  type ExecuteDeviceActionReturnType,
} from '@ledgerhq/device-management-kit';
import { type TransactionSigningScheme } from '@thru/sdk';
import { of } from 'rxjs';

import { assertLedgerSigningScheme, type ThruLedgerError } from '../errors';
import { type AppConfig, type EoaAuthKindInput } from '../protocol/apdu';
import { type LedgerPathInput } from '../protocol/path';
import { type TokenHint } from '../protocol/token-hint';
import {
  type DeviceActionOptions,
  getAddressDeviceAction,
  getAppConfigDeviceAction,
  signEoaAuthDeviceAction,
  signMessageDeviceAction,
  signTransactionDeviceAction,
} from './device-actions';
import { type ProgressCallback, type SignatureOutput, type SignTransactionOutput } from './tasks';

export type ThruDeviceActionReturn<Output> = ExecuteDeviceActionReturnType<
  Output,
  ThruLedgerError | { _tag: string; originalError?: unknown },
  DeviceActionIntermediateValue
>;

export interface SignerThruOptions extends DeviceActionOptions {
  onProgress?: ProgressCallback;
}

export interface SignTransactionOptions extends SignerThruOptions {
  /** Token transfer mint and owners (`specs/ledger/app-thru-apdu.md` §7.2.1). */
  tokenHint?: TokenHint;
}

export interface SignMessageOptions extends SignerThruOptions {
  /** The 32-byte key expected for the path; a different device key fails with `KeyMismatchError` before the device prompt. */
  expectedPublicKey?: Uint8Array;
}

export interface SignerThru {
  getAddress(path: LedgerPathInput, options?: DeviceActionOptions & { display?: boolean }): ThruDeviceActionReturn<Uint8Array>;
  getAppConfig(options?: DeviceActionOptions): ThruDeviceActionReturn<AppConfig>;
  signTransaction(path: LedgerPathInput, body: Uint8Array, options?: SignTransactionOptions): ThruDeviceActionReturn<SignTransactionOutput>;
  signMessage(path: LedgerPathInput, message: Uint8Array, options?: SignMessageOptions): ThruDeviceActionReturn<SignatureOutput>;
  signEoaAuth(
    path: LedgerPathInput,
    kind: EoaAuthKindInput,
    chainId: number,
    feePayer: Uint8Array,
    account: Uint8Array,
    options?: DeviceActionOptions,
  ): ThruDeviceActionReturn<SignatureOutput>;
}

export interface SignerThruArgs {
  dmk: DeviceManagementKit;
  sessionId: DeviceSessionId;
  /**
   * The target network's outer-transaction signing scheme
   * (`thru.ctx.transactionSigningScheme`). Signing operations are refused
   * without contacting the device unless it is RFC-8032 (D11, spec §11.1).
   */
  transactionSigningScheme: TransactionSigningScheme;
}

/** A device action that fails at once with `error` and never touches the device. */
function refusedAction<Output>(error: ThruLedgerError): ThruDeviceActionReturn<Output> {
  return {
    observable: of({ status: DeviceActionStatus.Error, error } as const),
    cancel: () => undefined,
  };
}

export class DefaultSignerThru implements SignerThru {
  readonly #dmk: DeviceManagementKit;
  readonly #sessionId: DeviceSessionId;
  /* Typed as required; untyped callers may still pass nothing, which #refuseScheme rejects. */
  readonly #scheme: TransactionSigningScheme;

  constructor(args: SignerThruArgs) {
    this.#dmk = args.dmk;
    this.#sessionId = args.sessionId;
    this.#scheme = args.transactionSigningScheme;
  }

  /** D11: `null` if signing may proceed, otherwise a pre-failed action. */
  #refuseScheme<Output>(): ThruDeviceActionReturn<Output> | null {
    try {
      assertLedgerSigningScheme(this.#scheme);
      return null;
    } catch (e) {
      return refusedAction<Output>(e as ThruLedgerError);
    }
  }

  #run<Output>(deviceAction: Parameters<DeviceManagementKit['executeDeviceAction']>[0]['deviceAction']): ThruDeviceActionReturn<Output> {
    return this.#dmk.executeDeviceAction({ sessionId: this.#sessionId, deviceAction }) as ThruDeviceActionReturn<Output>;
  }

  getAddress(path: LedgerPathInput, options: DeviceActionOptions & { display?: boolean } = {}): ThruDeviceActionReturn<Uint8Array> {
    return this.#run(getAddressDeviceAction({ path, display: options.display ?? false }, options));
  }

  getAppConfig(options: DeviceActionOptions = {}): ThruDeviceActionReturn<AppConfig> {
    return this.#run(getAppConfigDeviceAction(options));
  }

  signTransaction(path: LedgerPathInput, body: Uint8Array, options: SignTransactionOptions = {}): ThruDeviceActionReturn<SignTransactionOutput> {
    return (
      this.#refuseScheme<SignTransactionOutput>() ??
      this.#run(
        signTransactionDeviceAction(
          {
            path,
            body,
            tokenHint: options.tokenHint,
            onProgress: options.onProgress,
            transactionSigningScheme: this.#scheme,
          },
          options,
        ),
      )
    );
  }

  signMessage(path: LedgerPathInput, message: Uint8Array, options: SignMessageOptions = {}): ThruDeviceActionReturn<SignatureOutput> {
    return (
      this.#refuseScheme<SignatureOutput>() ??
      this.#run(
        signMessageDeviceAction(
          {
            path,
            message,
            expectedPublicKey: options.expectedPublicKey,
            onProgress: options.onProgress,
            transactionSigningScheme: this.#scheme,
          },
          options,
        ),
      )
    );
  }

  signEoaAuth(
    path: LedgerPathInput,
    kind: EoaAuthKindInput,
    chainId: number,
    feePayer: Uint8Array,
    account: Uint8Array,
    options: DeviceActionOptions = {},
  ): ThruDeviceActionReturn<SignatureOutput> {
    return (
      this.#refuseScheme<SignatureOutput>() ??
      this.#run(
        signEoaAuthDeviceAction(
          { path, kind, chainId, feePayer, account, transactionSigningScheme: this.#scheme },
          options,
        ),
      )
    );
  }
}

/** `new SignerThruBuilder({ dmk, sessionId, transactionSigningScheme }).build()`. */
export class SignerThruBuilder {
  readonly #args: SignerThruArgs;

  constructor(args: SignerThruArgs) {
    this.#args = { ...args };
  }

  build(): SignerThru {
    return new DefaultSignerThru(this.#args);
  }
}
