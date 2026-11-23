/**
 * Convert anything a DMK command, task or device action can fail with into a
 * typed {@link ThruLedgerError}.
 */
import {
  CancelledError,
  LockedError,
  ProtocolError,
  statusWordToError,
  ThruLedgerError,
  TransportError,
  UserRejectedError,
  WrongAppError,
  type StatusWordContext,
} from '../errors';

interface TaggedError {
  _tag?: unknown;
  errorCode?: unknown;
  statusWord?: unknown;
  ins?: unknown;
  message?: unknown;
  originalError?: unknown;
}

function describe(err: TaggedError): string {
  if (typeof err.message === 'string' && err.message !== '') return err.message;
  const orig = err.originalError;
  if (orig instanceof Error) return orig.message;
  return typeof err._tag === 'string' ? err._tag : 'unknown error';
}

const HEX_SW = /^[0-9a-f]{4}$/i;

export function toThruLedgerError(error: unknown, context: StatusWordContext = {}): ThruLedgerError {
  if (error instanceof ThruLedgerError) return error;
  if (typeof error !== 'object' || error === null) {
    return new TransportError(String(error), { cause: error });
  }
  const err = error as TaggedError;
  const tag = typeof err._tag === 'string' ? err._tag : '';

  /* Our command errors carry the raw status word and the INS. */
  if (typeof err.statusWord === 'number') {
    const ins = typeof err.ins === 'number' ? err.ins : context.ins;
    return statusWordToError(err.statusWord, { ins });
  }

  /* OS command errors (open-app flow). */
  if (tag === 'OpenAppCommandError') {
    if (err.errorCode === '6807') return new WrongAppError('not_installed', { cause: error });
    return new WrongAppError('not_open', { cause: error });
  }
  if (tag === 'DeviceLockedError') return new LockedError({ cause: error });
  if (tag === 'RefusedByUserDAError' || tag === 'ActionRefusedError') {
    return new UserRejectedError({ cause: error });
  }
  if (tag === 'InvalidResponseFormatError' || tag === 'InvalidStatusWordError') {
    return new ProtocolError('invalid_response', describe(err), { cause: error });
  }

  /* Global/unknown device-exchange errors with a status word. */
  if (typeof err.errorCode === 'string' && HEX_SW.test(err.errorCode)) {
    return statusWordToError(parseInt(err.errorCode, 16), context);
  }

  if (error instanceof Error && error.name === 'AbortError') return new CancelledError();
  return new TransportError(`${tag === '' ? 'error' : tag}: ${describe(err)}`, { cause: error });
}
