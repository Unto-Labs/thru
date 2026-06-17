import { afterEach, describe, expect, it, vi } from 'vitest';
import { signWithPasskey } from './sign';

function createAssertion(): PublicKeyCredential {
  return {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    response: {
      signature: new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]).buffer,
      authenticatorData: new Uint8Array([4, 5, 6]).buffer,
      clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
    },
    authenticatorAttachment: 'platform',
  } as PublicKeyCredential;
}

describe('passkey signing', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries WebAuthn assertions when the wallet document is not focused yet', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { PublicKeyCredential: function PublicKeyCredential() {} });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      setTimeout(() => callback(0), 0);
      return 0;
    });

    const credentialsGet = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('The document is not focused.', 'NotAllowedError'))
      .mockResolvedValueOnce(createAssertion());
    vi.stubGlobal('navigator', {
      credentials: {
        get: credentialsGet,
      },
    });

    const resultPromise = signWithPasskey('AQID', new Uint8Array([10, 11, 12]), 'wallet.example');
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(credentialsGet).toHaveBeenCalledTimes(2);
    expect(result.signature).toHaveLength(64);
    expect(result.authenticatorAttachment).toBe('platform');
  });
});
