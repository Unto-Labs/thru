/**
 * DMK device-action factories, one per signer operation. Each wraps a task
 * in `CallTaskInAppDeviceAction`, which first runs DMK's open-app flow for
 * the "Thru" app (unless `skipOpenApp`) and then the task, holding the
 * session's intent queue for the whole APDU sequence.
 */
import {
  CallTaskInAppDeviceAction,
  type LoggerPublisherService,
  UserInteractionRequired,
} from '@ledgerhq/device-management-kit';

import { type ThruLedgerError } from '../errors';
import { type AppConfig } from '../protocol/apdu';
import { THRU_APP_NAME } from '../protocol/constants';
import {
  getAddressTask,
  type GetAddressTaskArgs,
  getAppConfigTask,
  signEoaAuthTask,
  type SignEoaAuthTaskArgs,
  signMessageTask,
  type SignMessageTaskArgs,
  type SignatureOutput,
  signTransactionTask,
  type SignTransactionOutput,
  type SignTransactionTaskArgs,
} from './tasks';

export interface DeviceActionOptions {
  /** Skip DMK's open-app flow (the caller guarantees the Thru app is open). */
  skipOpenApp?: boolean;
  logger?: LoggerPublisherService;
}

type ThruDeviceAction<Output, Interaction extends UserInteractionRequired> = CallTaskInAppDeviceAction<
  Output,
  ThruLedgerError,
  Interaction
>;

export function getAddressDeviceAction(
  args: GetAddressTaskArgs,
  options: DeviceActionOptions = {},
): ThruDeviceAction<Uint8Array, UserInteractionRequired.VerifyAddress | UserInteractionRequired.None> {
  return new CallTaskInAppDeviceAction({
    input: {
      task: (api) => getAddressTask(api, args),
      appName: THRU_APP_NAME,
      requiredUserInteraction: args.display ? UserInteractionRequired.VerifyAddress : UserInteractionRequired.None,
      skipOpenApp: options.skipOpenApp ?? false,
    },
    logger: options.logger,
  });
}

export function getAppConfigDeviceAction(
  options: DeviceActionOptions = {},
): ThruDeviceAction<AppConfig, UserInteractionRequired.None> {
  return new CallTaskInAppDeviceAction({
    input: {
      task: (api) => getAppConfigTask(api),
      appName: THRU_APP_NAME,
      requiredUserInteraction: UserInteractionRequired.None,
      skipOpenApp: options.skipOpenApp ?? false,
    },
    logger: options.logger,
  });
}

const copyBytes = (b: Uint8Array | undefined): Uint8Array | undefined => (b === undefined ? undefined : new Uint8Array(b));

export function signTransactionDeviceAction(
  callerArgs: SignTransactionTaskArgs,
  options: DeviceActionOptions = {},
): ThruDeviceAction<SignTransactionOutput, UserInteractionRequired.SignTransaction> {
  /* Copy once: the task starts after the open-app flow, which can wait on the user. */
  const hint = callerArgs.tokenHint;
  const args: SignTransactionTaskArgs = Object.freeze({
    ...callerArgs,
    body: new Uint8Array(callerArgs.body),
    tokenHint:
      hint === undefined
        ? undefined
        : Object.freeze({
            ...hint,
            mint: new Uint8Array(hint.mint),
            recipientOwner: new Uint8Array(hint.recipientOwner),
            recipientSeed: copyBytes(hint.recipientSeed),
            sourceSeed: copyBytes(hint.sourceSeed),
          }),
  });
  return new CallTaskInAppDeviceAction({
    input: {
      task: (api) => signTransactionTask(api, args),
      appName: THRU_APP_NAME,
      requiredUserInteraction: UserInteractionRequired.SignTransaction,
      skipOpenApp: options.skipOpenApp ?? false,
    },
    logger: options.logger,
  });
}

export function signMessageDeviceAction(
  callerArgs: SignMessageTaskArgs,
  options: DeviceActionOptions = {},
): ThruDeviceAction<SignatureOutput, UserInteractionRequired.SignPersonalMessage> {
  /* Copy once: the task starts after the open-app flow, which can wait on the user. */
  const args: SignMessageTaskArgs = Object.freeze({
    ...callerArgs,
    message: new Uint8Array(callerArgs.message),
    expectedPublicKey: copyBytes(callerArgs.expectedPublicKey),
  });
  return new CallTaskInAppDeviceAction({
    input: {
      task: (api) => signMessageTask(api, args),
      appName: THRU_APP_NAME,
      requiredUserInteraction: UserInteractionRequired.SignPersonalMessage,
      skipOpenApp: options.skipOpenApp ?? false,
    },
    logger: options.logger,
  });
}

export function signEoaAuthDeviceAction(
  callerArgs: SignEoaAuthTaskArgs,
  options: DeviceActionOptions = {},
): ThruDeviceAction<SignatureOutput, UserInteractionRequired.SignTransaction> {
  /* Copy once: the task starts after the open-app flow, which can wait on the user. */
  const args: SignEoaAuthTaskArgs = Object.freeze({
    ...callerArgs,
    feePayer: new Uint8Array(callerArgs.feePayer),
    account: new Uint8Array(callerArgs.account),
  });
  return new CallTaskInAppDeviceAction({
    input: {
      task: (api) => signEoaAuthTask(api, args),
      appName: THRU_APP_NAME,
      requiredUserInteraction: UserInteractionRequired.SignTransaction,
      skipOpenApp: options.skipOpenApp ?? false,
    },
    logger: options.logger,
  });
}
