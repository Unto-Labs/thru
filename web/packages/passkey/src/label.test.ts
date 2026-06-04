import { describe, expect, it } from 'vitest';
import { createDistinctPasskeyLabel } from './label';

describe('createDistinctPasskeyLabel', () => {
  it('keeps a provided passkey label exactly without appending random hex', () => {
    expect(
      createDistinctPasskeyLabel('Jerry iPhone', {
        suffixFactory: () => 'a1b2c3',
      })
    ).toBe('Jerry iPhone');
  });

  it('uses the default fallback exactly when the label is blank', () => {
    expect(
      createDistinctPasskeyLabel('   ', {
        existingLabels: ['Thru Wallet passkey'],
        suffixFactory: () => 'a1b2c3',
      })
    ).toBe('Thru Wallet passkey');
  });
});
