const PASSKEY_ERRORS = {
  USER_CANCELLED: [
    'error 1001',
    'UserCancelled',
    'Passkey authentication was cancelled',
    'Passkey registration was cancelled',
  ],
  NOT_FOUND: [
    'not found',
    'No credentials available',
    'no passkey',
    'NoCredentials',
  ],
} as const;

export type PasskeyErrorKind = keyof typeof PASSKEY_ERRORS;

export function classifyPasskeyError(error: unknown): PasskeyErrorKind | null {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : null;

  if (!message) return null;

  for (const [kind, patterns] of Object.entries(PASSKEY_ERRORS)) {
    if (patterns.some((pattern) => message.includes(pattern))) {
      return kind as PasskeyErrorKind;
    }
  }

  return null;
}
