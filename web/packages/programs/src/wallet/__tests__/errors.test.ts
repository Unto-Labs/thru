import { describe, expect, it } from 'vitest';
import { walletProgramErrorFromCode, walletProgramErrorMessage } from '../errors';

describe('wallet policy errors', () => {
  it.each([
    [91, 91n, 'This wallet authority has expired. Approve a new session with your passkey.'],
    [92, 92n, 'This wallet change requires direct passkey approval.'],
    [93, 93n, 'A session must expire within 24 hours and no later than its parent session.'],
  ] as const)('maps numeric code %s to a readable policy error', (numberCode, bigintCode, message) => {
    const numberError = walletProgramErrorFromCode(numberCode);
    const bigintError = walletProgramErrorFromCode(bigintCode);
    expect(numberError).toBe(numberCode);
    expect(bigintError).toBe(numberCode);
    expect(walletProgramErrorMessage(numberError!)).toBe(message);
  });

  it.each([0, 90, 94, 92.5, NaN, Infinity, -92, 0n, 94n, 2n ** 64n])(
    'leaves unknown or invalid code %s unmapped', (code) => {
      expect(walletProgramErrorFromCode(code)).toBeNull();
      expect(walletProgramErrorFromCode(92n)).toBe(92);
    }
  );
});
