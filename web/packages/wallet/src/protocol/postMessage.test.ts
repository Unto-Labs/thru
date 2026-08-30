import { describe, expect, it } from 'vitest';

import { MAX_PASSKEY_NAME_LENGTH, sanitizePasskeyName } from './postMessage';

describe('sanitizePasskeyName', () => {
  it('returns undefined for missing or blank input', () => {
    expect(sanitizePasskeyName(undefined)).toBeUndefined();
    expect(sanitizePasskeyName('')).toBeUndefined();
    expect(sanitizePasskeyName('   ')).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizePasskeyName('  My App — alice@example.com  ')).toBe(
      'My App — alice@example.com'
    );
  });

  it('caps the name at the maximum length', () => {
    const long = 'a'.repeat(MAX_PASSKEY_NAME_LENGTH + 20);
    expect(sanitizePasskeyName(long)).toBe('a'.repeat(MAX_PASSKEY_NAME_LENGTH));
  });

  it('keeps a valid name unchanged', () => {
    expect(sanitizePasskeyName('PackRip — jerry')).toBe('PackRip — jerry');
  });
});
