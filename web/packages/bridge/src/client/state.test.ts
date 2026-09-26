import { describe, expect, it } from 'vitest';
import { TOKEN_PROGRAM_ADDRESS } from '@thru/sdk';
import { buildBridgeClientState } from './state';

function state(tokenProgramAddress?: string) {
  return buildBridgeClientState({ thru: {
    thruBridgeProgramAddress: TOKEN_PROGRAM_ADDRESS,
    tokenProgramAddress,
    signer: {
      baseUrl: 'http://127.0.0.1:8080',
      feePayerAddress: TOKEN_PROGRAM_ADDRESS,
      feePayerPrivateKey: '11'.repeat(32),
    },
  } }).thru;
}

describe('bridge token program configuration', () => {
  it('defaults to the canonical Token program', () => {
    expect(state()?.tokenProgramAddress).toBe(TOKEN_PROGRAM_ADDRESS);
  });
  it('preserves an explicit deployed program', () => {
    const legacy = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq';
    expect(state(legacy)?.tokenProgramAddress).toBe(legacy);
  });
  it('rejects malformed overrides', () => {
    expect(() => state('not-an-address')).toThrow();
  });
});
