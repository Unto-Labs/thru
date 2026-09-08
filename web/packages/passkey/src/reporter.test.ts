import { describe, expect, it, vi } from 'vitest';
import {
  reportPasskeyCeremony,
  serializePasskeyCredential,
  type PasskeyCeremonyReporter,
} from './reporter';

const GET_INFO = {
  kind: 'get',
  mode: 'inline',
  allowCredentials: false,
} as const;

function createReporter() {
  return { started: vi.fn(), finished: vi.fn(), failed: vi.fn() };
}

describe('passkey credential serialization', () => {
  it('preserves the original DER assertion signature without requiring toJSON', () => {
    const credential = {
      id: 'credential-id',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      authenticatorAttachment: 'cross-platform',
      response: {
        clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
        authenticatorData: new Uint8Array([4, 5, 6]).buffer,
        signature: new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]).buffer,
      },
    } as PublicKeyCredential;

    expect(serializePasskeyCredential(credential, 'get')).toEqual({
      id: 'credential-id',
      rawId: 'AQID',
      type: 'public-key',
      authenticatorAttachment: 'cross-platform',
      response: {
        clientDataJSON: 'BwgJ',
        authenticatorData: 'BAUG',
        signature: 'MAYCAQECAQI',
      },
    });
  });

  it('serializes attestation bytes and transports without invoking toJSON', () => {
    const toJSON = vi.fn(() => {
      throw new Error('Unsupported toJSON');
    });
    const credential = {
      id: '',
      rawId: new Uint8Array([251, 255]).buffer,
      authenticatorAttachment: null,
      toJSON,
      response: {
        clientDataJSON: new Uint8Array([1, 2, 3]).buffer,
        attestationObject: new Uint8Array([4, 5, 6]).buffer,
        getTransports: () => ['internal', 'hybrid'],
      },
    } as unknown as PublicKeyCredential;

    expect(serializePasskeyCredential(credential, 'create')).toEqual({
      id: '-_8',
      rawId: '-_8',
      type: 'public-key',
      response: {
        clientDataJSON: 'AQID',
        attestationObject: 'BAUG',
        transports: ['internal', 'hybrid'],
      },
    });
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('supports attestation responses without optional getTransports', () => {
    const credential = {
      id: 'credential-id',
      rawId: new Uint8Array([1]).buffer,
      response: {
        clientDataJSON: new Uint8Array([2]).buffer,
        attestationObject: new Uint8Array([3]).buffer,
      },
    } as PublicKeyCredential;

    expect(serializePasskeyCredential(credential, 'create')?.response).toEqual({
      clientDataJSON: 'Ag',
      attestationObject: 'Aw',
      transports: undefined,
    });
  });

  it('drops unavailable telemetry when credential properties throw', () => {
    const credential = {
      get response() {
        throw new Error('Credential is no longer accessible');
      },
    } as PublicKeyCredential;

    expect(serializePasskeyCredential(credential, 'get')).toBeUndefined();
  });
});

describe('passkey ceremony reporter isolation', () => {
  it('returns the original result and emits one successful terminal', async () => {
    const reporter = createReporter();
    const result = { credentialJson: { id: 'raw-credential' } };
    const run = vi.fn(async () => result);

    await expect(reportPasskeyCeremony(reporter, GET_INFO, run)).resolves.toBe(result);
    expect(run).toHaveBeenCalledOnce();
    expect(reporter.started).toHaveBeenCalledExactlyOnceWith(GET_INFO);
    expect(reporter.finished).toHaveBeenCalledExactlyOnceWith({
      ...GET_INFO,
      credential: result.credentialJson,
    });
    expect(reporter.failed).not.toHaveBeenCalled();
  });

  it.each(['throw', 'reject'] as const)(
    'does not change a successful operation when callbacks %s',
    async (failureMode) => {
      const callback = vi.fn(() => {
        const error = new Error('Reporter unavailable');
        if (failureMode === 'throw') throw error;
        return Promise.reject(error);
      });
      const reporter: PasskeyCeremonyReporter = {
        started: callback,
        finished: callback,
        failed: vi.fn(),
      };
      const result = { value: 'authentication result' };

      await expect(reportPasskeyCeremony(reporter, GET_INFO, async () => result)).resolves.toBe(
        result
      );
      await Promise.resolve();
      expect(callback).toHaveBeenCalledTimes(2);
      expect(reporter.failed).not.toHaveBeenCalled();
    }
  );

  it.each(['throw', 'reject'] as const)(
    'preserves the authentication error when the failed callback %s',
    async (failureMode) => {
      const originalError = new DOMException('User cancelled', 'NotAllowedError');
      const reporter = createReporter();
      reporter.failed.mockImplementation(() => {
        const reporterError = new Error('Reporter unavailable');
        if (failureMode === 'throw') throw reporterError;
        return Promise.reject(reporterError);
      });

      await expect(
        reportPasskeyCeremony(reporter, GET_INFO, async () => {
          throw originalError;
        })
      ).rejects.toBe(originalError);
      await Promise.resolve();
      expect(reporter.started).toHaveBeenCalledOnce();
      expect(reporter.failed).toHaveBeenCalledExactlyOnceWith({
        ...GET_INFO,
        error: originalError,
      });
      expect(reporter.finished).not.toHaveBeenCalled();
    }
  );

  it('does not await reporter callbacks', async () => {
    const reporter: PasskeyCeremonyReporter = {
      started: () => new Promise(() => {}),
      finished: () => new Promise(() => {}),
      failed: () => new Promise(() => {}),
    };

    await expect(reportPasskeyCeremony(reporter, GET_INFO, async () => 'signed')).resolves.toBe(
      'signed'
    );
  });

  it('works without a reporter', async () => {
    const result = { value: 'signed' };
    await expect(reportPasskeyCeremony(undefined, GET_INFO, async () => result)).resolves.toBe(
      result
    );
  });
});
