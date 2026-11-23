/**
 * DMK `Command`s for the Thru app: one class per INS, one APDU each. The
 * bytes come from the pure encoders in `src/protocol/apdu.ts`; non-`0x9000`
 * status words become a {@link ThruAppCommandError} carrying the raw status
 * word, which {@link toThruLedgerError} maps to a typed error.
 */
import {
  Apdu,
  type ApduResponse,
  type Command,
  type CommandResult,
  CommandResultFactory,
  DeviceExchangeError,
  InvalidResponseFormatError,
} from '@ledgerhq/device-management-kit';

import { ThruLedgerError } from '../errors';
import {
  type ApduCommand,
  type AppConfig,
  type AppVersion,
  decodeAppConfigResponse,
  decodeAppNameResponse,
  decodeEmptyResponse,
  decodePubkeyResponse,
  decodeSignatureResponse,
  decodeVersionResponse,
  type EoaAuthKindInput,
  getAppConfigApdu,
  getAppNameApdu,
  getPubkeyApdu,
  getVersionApdu,
  signEoaAuthApdu,
} from '../protocol/apdu';
import { Ins, P2_LAST } from '../protocol/constants';
import { type LedgerPathInput } from '../protocol/path';
import { formatStatusWord, StatusWord, statusWordFromBytes, statusWordName } from '../protocol/status-words';

/** Lowercase four-hex-digit status word, DMK's error-code convention. */
export type ThruAppErrorCode = string;

export const THRU_APP_COMMAND_ERROR_TAG = 'ThruAppCommandError';

/** A non-`0x9000` status word returned by the device for a Thru command. */
export class ThruAppCommandError extends DeviceExchangeError<ThruAppErrorCode> {
  readonly statusWord: number;
  readonly ins: number;

  constructor(statusWord: number, ins: number) {
    super({
      tag: THRU_APP_COMMAND_ERROR_TAG,
      errorCode: formatStatusWord(statusWord).toLowerCase(),
      message: `Thru app returned ${statusWordName(statusWord)} (0x${formatStatusWord(statusWord)})`,
    });
    this.statusWord = statusWord;
    this.ins = ins;
  }
}

/** Base class: build the APDU from an {@link ApduCommand}, decode on `0x9000`. */
export abstract class ThruCommand<Response> implements Command<Response, void, ThruAppErrorCode> {
  abstract readonly name: string;
  readonly #apdu: ApduCommand;

  protected constructor(apdu: ApduCommand) {
    this.#apdu = apdu;
  }

  /** The exact request this command sends. */
  get request(): ApduCommand {
    return this.#apdu;
  }

  getApdu(): Apdu {
    const a = this.#apdu;
    return new Apdu(a.cla, a.ins, a.p1, a.p2, a.data);
  }

  parseResponse(response: ApduResponse): CommandResult<Response, ThruAppErrorCode> {
    let sw: number;
    try {
      sw = statusWordFromBytes(response.statusCode);
    } catch (e) {
      return CommandResultFactory({ error: new InvalidResponseFormatError(String(e)) });
    }
    if (sw !== StatusWord.OK) {
      return CommandResultFactory({ error: new ThruAppCommandError(sw, this.#apdu.ins) });
    }
    try {
      return CommandResultFactory({ data: this.decode(response.data) });
    } catch (e) {
      const message = e instanceof ThruLedgerError ? e.message : String(e);
      return CommandResultFactory({ error: new InvalidResponseFormatError(message) });
    }
  }

  protected abstract decode(data: Uint8Array): Response;
}

export class GetVersionCommand extends ThruCommand<AppVersion> {
  readonly name = 'thru.getVersion';
  constructor() {
    super(getVersionApdu());
  }
  protected decode(data: Uint8Array): AppVersion {
    return decodeVersionResponse(data);
  }
}

export class GetAppNameCommand extends ThruCommand<string> {
  readonly name = 'thru.getAppName';
  constructor() {
    super(getAppNameApdu());
  }
  protected decode(data: Uint8Array): string {
    return decodeAppNameResponse(data);
  }
}

export class GetAppConfigCommand extends ThruCommand<AppConfig> {
  readonly name = 'thru.getAppConfig';
  constructor() {
    super(getAppConfigApdu());
  }
  protected decode(data: Uint8Array): AppConfig {
    return decodeAppConfigResponse(data);
  }
}

export interface GetPubkeyCommandArgs {
  path: LedgerPathInput;
  /** P1 = 1: show the address on the device and wait for confirmation. */
  display: boolean;
}

export class GetPubkeyCommand extends ThruCommand<Uint8Array> {
  readonly name = 'thru.getPubkey';
  constructor(args: GetPubkeyCommandArgs) {
    super(getPubkeyApdu(args.path, args.display));
  }
  protected decode(data: Uint8Array): Uint8Array {
    return decodePubkeyResponse(data);
  }
}

/**
 * One chunk of a SIGN_TXN or SIGN_MESSAGE stream (a planned {@link ApduCommand}).
 * Returns the signature when the device sends one (the final chunk of
 * SIGN_TXN, the final pass-2 chunk of SIGN_MESSAGE), otherwise `null`.
 */
export class SignChunkCommand extends ThruCommand<Uint8Array | null> {
  readonly name: string;
  readonly #expectsSignature: boolean;

  /**
   * @param expectsSignature whether this chunk must return `sig[64]`
   *   (`false` for intermediate chunks and for the end of message pass 1).
   */
  constructor(apdu: ApduCommand, expectsSignature: boolean) {
    if (apdu.ins !== Ins.SIGN_TXN && apdu.ins !== Ins.SIGN_MESSAGE) {
      throw new Error('SignChunkCommand only carries SIGN_TXN / SIGN_MESSAGE chunks');
    }
    if (expectsSignature && apdu.p2 !== P2_LAST) {
      throw new Error('only a last chunk can return a signature');
    }
    super(apdu);
    this.name = `${apdu.ins === Ins.SIGN_TXN ? 'thru.signTxn' : 'thru.signMessage'}[${apdu.p1}]`;
    this.#expectsSignature = expectsSignature;
  }

  protected decode(data: Uint8Array): Uint8Array | null {
    if (this.#expectsSignature) return decodeSignatureResponse(data);
    decodeEmptyResponse(this.name, data);
    return null;
  }
}

export interface SignEoaAuthCommandArgs {
  path: LedgerPathInput;
  kind: EoaAuthKindInput;
  chainId: number;
  feePayer: Uint8Array;
  account: Uint8Array;
}

export class SignEoaAuthCommand extends ThruCommand<Uint8Array> {
  readonly name = 'thru.signEoaAuth';
  constructor(args: SignEoaAuthCommandArgs) {
    super(signEoaAuthApdu(args.path, args.kind, args.chainId, args.feePayer, args.account));
  }
  protected decode(data: Uint8Array): Uint8Array {
    return decodeSignatureResponse(data);
  }
}
