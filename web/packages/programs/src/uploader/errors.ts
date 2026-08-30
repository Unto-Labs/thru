export const UPLOADER_ERRORS = {
  1: 'NOT_AUTHORIZED',
  2: 'INVALID_ARGS',
  3: 'META_ACCOUNT_MISSING',
  4: 'BUFFER_ACCOUNT_MISSING',
  5: 'ACCOUNT_NOT_OPEN',
  6: 'HASH_MISMATCH',
  7: 'WRITE_OVERFLOW',
  8: 'WRITE_OUT_OF_BOUNDS',
  9: 'INVALID_ACCOUNT_INDEX',
  10: 'INVALID_META_SIZE',
  11: 'ACCOUNT_RELATIONSHIP',
  12: 'INVALID_INSTRUCTION',
} as const;

export type UploaderErrorName =
  (typeof UPLOADER_ERRORS)[keyof typeof UPLOADER_ERRORS];

export function uploaderErrorName(code: number | bigint): UploaderErrorName | undefined {
  const normalized = typeof code === 'bigint' ? Number(code) : code;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error('uploader error code must be a non-negative integer');
  }
  return UPLOADER_ERRORS[normalized as keyof typeof UPLOADER_ERRORS];
}
