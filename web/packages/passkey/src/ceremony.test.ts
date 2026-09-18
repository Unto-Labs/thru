import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPasskey } from './register';
import { signWithDiscoverablePasskey, signWithPasskey, signWithStoredPasskey } from './sign';

function createAssertion(): PublicKeyCredential {
  return {
    id: 'AQID',
    rawId: new Uint8Array([1, 2, 3]).buffer,
    response: {
      /* s is the P-256 group order minus two; wallet signing normalizes it to two. */
      signature: new Uint8Array([
        0x30, 0x26, 0x02, 0x01, 0x01, 0x02, 0x21, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00,
        0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17,
        0x9e, 0x84, 0xf3, 0xb9, 0xca, 0xc2, 0xfc, 0x63, 0x25, 0x4f,
      ]).buffer,
      authenticatorData: new Uint8Array([4, 5, 6]).buffer,
      clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
    },
    authenticatorAttachment: 'platform',
  } as PublicKeyCredential;
}

function createAttestation(): PublicKeyCredential {
  return {
    id: 'AQID',
    rawId: new Uint8Array([1, 2, 3]).buffer,
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
      attestationObject: new Uint8Array([4, 5, 6]).buffer,
      getPublicKey: () =>
        new Uint8Array([0x04, ...new Uint8Array(32).fill(1), ...new Uint8Array(32).fill(2)]).buffer,
    },
  } as PublicKeyCredential;
}

function createReporter() {
  return { started: vi.fn(), finished: vi.fn(), failed: vi.fn() };
}

describe('reported WebAuthn ceremonies', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      PublicKeyCredential: function PublicKeyCredential() {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves original assertion bytes alongside the normalized wallet signature', async () => {
    const reporter = createReporter();
    const get = vi.fn(async () => createAssertion());
    vi.stubGlobal('navigator', { credentials: { get } });

    const result = await signWithPasskey('AQID', new Uint8Array([10]), 'wallet.example', {
      ceremonyReporter: reporter,
    });

    expect(result.signature).toHaveLength(64);
    expect(result.signatureR[31]).toBe(1);
    expect(result.signatureS[31]).toBe(2);
    expect(result.credentialJson?.response).toEqual({
      signature: 'MCYCAQECIQD_____AAAAAP__________vOb6racXnoTzucrC_GMlTw',
      authenticatorData: 'BAUG',
      clientDataJSON: 'BwgJ',
    });
    expect(reporter.started).toHaveBeenCalledExactlyOnceWith({
      kind: 'get',
      mode: 'inline',
      allowCredentials: true,
    });
    expect(reporter.finished).toHaveBeenCalledExactlyOnceWith({
      kind: 'get',
      mode: 'inline',
      allowCredentials: true,
      credential: result.credentialJson,
    });
    expect(reporter.failed).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledOnce();
  });

  it('retains reporting and original response through native discoverable stored signing', async () => {
    const reporter = createReporter();
    const get = vi.fn(async () => createAssertion());
    vi.stubGlobal('navigator', { credentials: { get } });

    const result = await signWithStoredPasskey(
      new Uint8Array([10]),
      'wallet.example',
      null,
      [],
      undefined,
      {
        allowPopupFallback: false,
        preferDiscoverable: true,
        ceremonyReporter: reporter,
      }
    );

    expect(get).toHaveBeenCalledExactlyOnceWith({
      signal: expect.any(AbortSignal),
      publicKey: expect.not.objectContaining({
        allowCredentials: expect.anything(),
      }),
    });
    expect(result.passkey.credentialId).toBe('AQID');
    expect(result.credentialJson?.rawId).toBe('AQID');
    expect(reporter.started).toHaveBeenCalledExactlyOnceWith({
      kind: 'get',
      mode: 'inline',
      allowCredentials: false,
    });
    expect(reporter.finished).toHaveBeenCalledOnce();
    expect(reporter.failed).not.toHaveBeenCalled();
  });

  it('returns registration keys and reports the attestation response without toJSON', async () => {
    const reporter = createReporter();
    const create = vi.fn(async () => createAttestation());
    vi.stubGlobal('navigator', { credentials: { create } });

    const result = await registerPasskey('Phone', 'profile-1', 'wallet.example', {
      allowPopupFallback: false,
      ceremonyReporter: reporter,
    });

    expect(result).toMatchObject({
      credentialId: 'AQID',
      publicKeyX: '01'.repeat(32),
      publicKeyY: '02'.repeat(32),
      rpId: 'wallet.example',
    });
    expect(result.credentialJson?.response).toEqual({
      clientDataJSON: 'BwgJ',
      attestationObject: 'BAUG',
      transports: undefined,
    });
    expect(reporter.started).toHaveBeenCalledExactlyOnceWith({
      kind: 'create',
      mode: 'inline',
    });
    expect(reporter.finished).toHaveBeenCalledExactlyOnceWith({
      kind: 'create',
      mode: 'inline',
      credential: result.credentialJson,
    });
    expect(reporter.failed).not.toHaveBeenCalled();
  });

  it.each(['get', 'create'] as const)(
    'reports a null %s credential as one failure',
    async (kind) => {
      const reporter = createReporter();
      vi.stubGlobal('navigator', {
        credentials: { [kind]: vi.fn(async () => null) },
      });

      const pending =
        kind === 'get'
          ? signWithDiscoverablePasskey(new Uint8Array([10]), 'wallet.example', {
              ceremonyReporter: reporter,
            })
          : registerPasskey('Phone', 'profile-1', 'wallet.example', {
              allowPopupFallback: false,
              ceremonyReporter: reporter,
            });

      await expect(pending).rejects.toThrow(
        kind === 'get'
          ? 'Passkey authentication was cancelled'
          : 'Passkey registration was cancelled'
      );
      expect(reporter.started).toHaveBeenCalledOnce();
      expect(reporter.failed).toHaveBeenCalledOnce();
      expect(reporter.finished).not.toHaveBeenCalled();
    }
  );

  it('retains the WebAuthn error when a reporter rejects', async () => {
    const originalError = new DOMException('User cancelled', 'NotAllowedError');
    const failed = vi.fn(async () => {
      throw new Error('Reporter is unavailable');
    });
    const reporter = { started: vi.fn(), finished: vi.fn(), failed };
    vi.stubGlobal('navigator', {
      credentials: {
        get: vi.fn(async () => {
          throw originalError;
        }),
      },
    });

    await expect(
      signWithDiscoverablePasskey(new Uint8Array([10]), 'wallet.example', {
        ceremonyReporter: reporter,
      })
    ).rejects.toBe(originalError);
    await Promise.resolve();
    expect(failed).toHaveBeenCalledExactlyOnceWith({
      kind: 'get',
      mode: 'inline',
      allowCredentials: false,
      error: originalError,
    });
    expect(reporter.finished).not.toHaveBeenCalled();
  });

  it('reports a focus failure once and leaves retry to the user', async () => {
    const reporter = createReporter();
    const error = new DOMException('The document is not focused.', 'NotAllowedError');
    const get = vi.fn().mockRejectedValue(error);
    vi.stubGlobal('navigator', { credentials: { get } });
    await expect(
      signWithDiscoverablePasskey(new Uint8Array([10]), 'wallet.example', {
        ceremonyReporter: reporter,
      })
    ).rejects.toBe(error);
    expect(get).toHaveBeenCalledOnce();
    expect(reporter.started).toHaveBeenCalledOnce();
    expect(reporter.failed).toHaveBeenCalledOnce();
    expect(reporter.finished).not.toHaveBeenCalled();
  });
});
