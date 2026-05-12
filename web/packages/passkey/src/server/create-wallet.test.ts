import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThruClient } from './types';

vi.mock('@thru/helpers', () => ({
  encodeAddress: (bytes: Uint8Array) => {
    const first = bytes[0];
    if (first === 11) return 'wallet-address';
    if (first === 22) return 'lookup-address';
    return `address-${Array.from(bytes).join('-')}`;
  },
}));

vi.mock('@thru/passkey-manager', () => ({
  PASSKEY_MANAGER_PROGRAM_ADDRESS: 'passkey-program',
  base64UrlToBytes: () => new Uint8Array([7]),
  buildAccountContext: (params: { readWriteAccounts: Uint8Array[] }) => ({
    walletAccountIdx: params.readWriteAccounts.length === 0 ? 2 : 3,
    readWriteAddresses:
      params.readWriteAccounts.length === 0
        ? ['wallet-address']
        : ['lookup-address', 'wallet-address'],
    readOnlyAddresses: [],
    getAccountIndex: () => 2,
  }),
  createCredentialLookupSeed: async () => new Uint8Array([8]),
  createWalletSeed: async () => new Uint8Array([1]),
  deriveCredentialLookupAddress: async () => new Uint8Array([22]),
  deriveWalletAddress: async () => new Uint8Array([11]),
  encodeCreateInstruction: () => new Uint8Array([101]),
  encodeRegisterCredentialInstruction: () => new Uint8Array([202]),
}));

import { createPasskeyWallet } from './create-wallet';

const feePayerQueueSymbol = Symbol.for('thru.sharedFeePayerQueues');

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function clearFeePayerQueues(): void {
  const globalQueues = globalThis as typeof globalThis & {
    [feePayerQueueSymbol]?: Map<string, Promise<void>>;
  };

  globalQueues[feePayerQueueSymbol]?.clear();
  delete globalQueues[feePayerQueueSymbol];
}

describe('createPasskeyWallet', () => {
  beforeEach(() => {
    clearFeePayerQueues();
  });

  it('re-checks wallet and credential existence after acquiring the serialized fee-payer lock', async () => {
    const walletTrackStarted = createDeferred<void>();
    const walletTrackRelease = createDeferred<void>();
    const lookupTrackStarted = createDeferred<void>();
    const lookupTrackRelease = createDeferred<void>();

    const state = {
      walletExists: false,
      lookupExists: false,
      walletTrackCount: 0,
      lookupTrackCount: 0,
    };

    const sentKinds: string[] = [];

    const client = {
      accounts: {
        get: vi.fn(async (address: string) => {
          if (address === 'wallet-address') {
            if (!state.walletExists) throw new Error('missing wallet');
            return { data: { data: new Uint8Array() } };
          }

          if (address === 'lookup-address') {
            if (!state.lookupExists) throw new Error('missing lookup');
            return { data: { data: new Uint8Array() } };
          }

          return { data: { data: new Uint8Array() } };
        }),
      },
      proofs: {
        generate: vi.fn(async () => ({ proof: new Uint8Array([9]) })),
      },
      transactions: {
        build: vi.fn(async (params: { accounts: { readWrite: string[] } }) => {
          const kind = params.accounts.readWrite.length === 1 ? 'wallet' : 'lookup';
          return {
            sign: vi.fn(async () => {}),
            toWire: () => new TextEncoder().encode(kind),
          };
        }),
        send: vi.fn(async (wire: Uint8Array) => {
          const kind = new TextDecoder().decode(wire);
          sentKinds.push(kind);
          return `${kind}-sig-${sentKinds.length}`;
        }),
        track: vi.fn(async function* (signature: string) {
          if (signature.startsWith('wallet-sig')) {
            state.walletTrackCount += 1;
            if (state.walletTrackCount === 1) {
              walletTrackStarted.resolve();
              await walletTrackRelease.promise;
              state.walletExists = true;
            }
          } else {
            state.lookupTrackCount += 1;
            if (state.lookupTrackCount === 1) {
              lookupTrackStarted.resolve();
              await lookupTrackRelease.promise;
              state.lookupExists = true;
            }
          }

          yield {
            executionResult: {
              userErrorCode: 0n,
              vmError: 0,
              executionResult: 0n,
            },
          };
        }),
      },
    } as unknown as ThruClient;

    const opts = {
      client,
      adminPublicKey: new Uint8Array([1, 2, 3]),
      adminPrivateKey: new Uint8Array([9, 9, 9]),
      adminAddress: 'admin-address',
      pubkeyX: new Uint8Array([4]),
      pubkeyY: new Uint8Array([5]),
      credentialId: 'credential-id',
      walletName: 'default-wallet',
    };

    const first = createPasskeyWallet(opts);
    await walletTrackStarted.promise;

    const second = createPasskeyWallet(opts);
    await Promise.resolve();

    walletTrackRelease.resolve();
    await lookupTrackStarted.promise;
    await Promise.resolve();

    lookupTrackRelease.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        walletAddress: 'wallet-address',
        credentialLookupAddress: 'lookup-address',
      },
      {
        walletAddress: 'wallet-address',
        credentialLookupAddress: 'lookup-address',
      },
    ]);

    expect(sentKinds).toEqual(['wallet', 'lookup']);
    expect(state.walletTrackCount).toBe(1);
    expect(state.lookupTrackCount).toBe(1);

    expect(vi.mocked(client.transactions.build).mock.calls[0]?.[0].accounts).toEqual({
      readWrite: ['wallet-address'],
      readOnly: [],
    });
    expect(vi.mocked(client.transactions.build).mock.calls[1]?.[0].accounts).toEqual({
      readWrite: ['lookup-address', 'wallet-address'],
      readOnly: [],
    });

    const accountChecks = vi.mocked(client.accounts.get).mock.calls.map(([address]) => address);
    expect(accountChecks.filter((address) => address === 'wallet-address')).toHaveLength(2);
    expect(accountChecks.filter((address) => address === 'lookup-address')).toHaveLength(2);
  });
});
