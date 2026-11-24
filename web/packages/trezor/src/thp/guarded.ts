/**
 * The THP namespace of `@trezor/protocol` with its three pairing-tag checks
 * guarded. The library's errors for a wrong code, tag or commitment quote the
 * value that was typed and the one it calculated, so each check here throws an
 * error of fixed text instead: it names the check and holds nothing of the
 * inputs, no `cause` and no other property. Everything else is the library's,
 * unchanged (a local export takes the place of the one `export *` brings).
 */
import {
  validateCodeEntryTag as libraryValidateCodeEntryTag,
  validateNfcTag as libraryValidateNfcTag,
  validateQrCodeTag as libraryValidateQrCodeTag,
} from '@trezor/protocol/lib/protocol-thp/index.js';

export * from '@trezor/protocol/lib/protocol-thp/index.js';

/** Calls `check`; on any throw, throws an error of the fixed `text` and nothing else. */
function guarded<A extends unknown[]>(check: (...args: A) => void, text: string): (...args: A) => void {
  return (...args: A): void => {
    try {
      check(...args);
    } catch {
      throw new Error(text);
    }
  };
}

export const validateCodeEntryTag: typeof libraryValidateCodeEntryTag = guarded(
  libraryValidateCodeEntryTag,
  'validateCodeEntryTag: the code or the commitment does not match',
);
export const validateQrCodeTag: typeof libraryValidateQrCodeTag = guarded(
  libraryValidateQrCodeTag,
  'validateQrCodeTag: the tag does not match',
);
export const validateNfcTag: typeof libraryValidateNfcTag = guarded(
  libraryValidateNfcTag,
  'validateNfcTag: the tag does not match',
);
