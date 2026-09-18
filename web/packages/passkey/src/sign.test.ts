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

  it('returns a focus failure for an explicit user retry', async () => {
    vi.stubGlobal('window', {
      PublicKeyCredential: function () {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const get = vi
      .fn()
      .mockRejectedValue(new DOMException('The document is not focused.', 'NotAllowedError'));
    vi.stubGlobal('navigator', { credentials: { get } });
    await expect(signWithPasskey('AQID', new Uint8Array(32), 'wallet.example')).rejects.toThrow(
      'not focused'
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  /* A wallet iframe whose browser can run the ceremony: the module's prompt-mode
     cache is per import, so each case loads a fresh copy. */
  async function loadFramedSigner(
    credentialsGet: ReturnType<typeof vi.fn>,
    open: ReturnType<typeof vi.fn>
  ) {
    vi.resetModules();
    vi.stubGlobal('window', {
      PublicKeyCredential: Object.assign(function PublicKeyCredential() {}, {
        getClientCapabilities: async () => ({
          passkeyPlatformAuthenticator: true,
          userVerifyingPlatformAuthenticator: true,
        }),
      }),
      self: { frame: 'child' },
      top: { frame: 'parent' },
      location: { origin: 'https://wallet.example', hostname: 'wallet.example' },
      open,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      setTimeout(() => callback(0), 0);
      return 0;
    });
    vi.stubGlobal('navigator', { credentials: { get: credentialsGet } });
    return import('./sign');
  }

  it('runs the discoverable ceremony inline in a frame that knows no stored passkey', async () => {
    const credentialsGet = vi.fn().mockResolvedValueOnce(createAssertion());
    const open = vi.fn();
    const { signWithStoredPasskey } = await loadFramedSigner(credentialsGet, open);

    const result = await signWithStoredPasskey(new Uint8Array(32), 'wallet.example', null, []);

    expect(open).not.toHaveBeenCalled();
    expect(credentialsGet).toHaveBeenCalledTimes(1);
    const request = credentialsGet.mock.calls[0][0] as {
      publicKey: PublicKeyCredentialRequestOptions;
    };
    expect(request.publicKey.allowCredentials ?? []).toHaveLength(0);
    expect(result.passkey.credentialId).toBe('AQID');
    expect(result.passkey.rpId).toBe('wallet.example');
  });

  /* The account switch depends on these two cases differing: a stored
     credential id pins the OS to one passkey, an omitted one shows the picker. */
  const STORED_PASSKEY = {
    credentialId: 'stored-cred',
    publicKeyX: '00'.repeat(32),
    publicKeyY: '11'.repeat(32),
    rpId: 'wallet.example',
    createdAt: '2026-05-20T00:00:00.000Z',
    lastUsedAt: '2026-05-20T00:00:00.000Z',
  };

  it('shows the picker when the caller forces it despite a stored passkey', async () => {
    const credentialsGet = vi.fn().mockResolvedValueOnce(createAssertion());
    const open = vi.fn();
    const { signWithStoredPasskey } = await loadFramedSigner(credentialsGet, open);

    const result = await signWithStoredPasskey(
      new Uint8Array(32),
      'wallet.example',
      STORED_PASSKEY,
      [STORED_PASSKEY],
      undefined,
      { preferDiscoverable: true }
    );

    expect(open).not.toHaveBeenCalled();
    const request = credentialsGet.mock.calls[0][0] as {
      publicKey: PublicKeyCredentialRequestOptions;
    };
    expect(request.publicKey.allowCredentials ?? []).toHaveLength(0);
    /* The credential the user actually picked, not the one we came in with. */
    expect(result.passkey.credentialId).toBe('AQID');
  });

  it('pins the stored credential when the picker is not forced', async () => {
    const credentialsGet = vi.fn().mockResolvedValueOnce(createAssertion());
    const open = vi.fn();
    const { signWithStoredPasskey } = await loadFramedSigner(credentialsGet, open);

    const result = await signWithStoredPasskey(
      new Uint8Array(32),
      'wallet.example',
      STORED_PASSKEY,
      [STORED_PASSKEY]
    );

    const request = credentialsGet.mock.calls[0][0] as {
      publicKey: PublicKeyCredentialRequestOptions;
    };
    expect(request.publicKey.allowCredentials ?? []).toHaveLength(1);
    expect(result.passkey).toBe(STORED_PASSKEY);
  });

  it('does not open a popup for TLS failures, including repeated attempts', async () => {
    const credentialsGet = vi
      .fn()
      .mockRejectedValue(
        new DOMException(
          'WebAuthn is not supported on sites with TLS certificate errors.',
          'NotAllowedError'
        )
      );
    const open = vi.fn();
    const { signWithStoredPasskey } = await loadFramedSigner(credentialsGet, open);
    for (let i = 0; i < 2; i++) {
      await expect(
        signWithStoredPasskey(new Uint8Array(32), 'wallet.example', null, [])
      ).rejects.toThrow('certificate');
    }
    expect(credentialsGet).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not open a popup when the user dismisses the inline prompt', async () => {
    const credentialsGet = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError')
      );
    const open = vi.fn(() => null);
    const { signWithStoredPasskey } = await loadFramedSigner(credentialsGet, open);

    await expect(
      signWithStoredPasskey(new Uint8Array(32), 'wallet.example', null, [])
    ).rejects.toThrow(/not allowed/);
    expect(open).not.toHaveBeenCalled();
  });
});
