import { describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '@thru/programs/passkey-manager';
import { encodeSignature } from '@thru/sdk/helpers';
import type { ThruClient } from './types';

const passkeyManagerMocks = vi.hoisted(() => ({
  PASSKEY_MANAGER_PROGRAM_ADDRESS: 'passkey-program',
  decodeAddress: vi.fn(() => new Uint8Array(32).fill(7)),
  encodeValidateInstruction: vi.fn(() => new Uint8Array([1, 2])),
  hexToBytes: (value: string) => new Uint8Array(Buffer.from(value, 'hex')),
}));

vi.mock('@thru/programs/passkey-manager', () => passkeyManagerMocks);

import { buildPasskeyTransaction, submitPasskeyTransaction } from './submit';

const accountCtx = {
  walletAccountIdx: 3,
  accountAddresses: ['fee-payer', 'passkey-program', 'wallet-address', 'readonly-address'],
  readWriteAddresses: ['lookup-address', 'wallet-address'],
  readOnlyAddresses: ['readonly-address'],
  getAccountIndex: vi.fn(() => 4),
} as AccountContext;

const signaturePayload = {
  signatureR: '11'.repeat(32),
  signatureS: '22'.repeat(32),
  authenticatorData: Buffer.from('authenticator').toString('base64'),
  clientDataJSON: Buffer.from('client').toString('base64'),
};

function createClient() {
  const signatureBytes = new Uint8Array(64).fill(7);
  const rawTransaction = new Uint8Array(64).fill(9);
  const transaction = {
    sign: vi.fn(async () => {}),
    toWire: vi.fn(() => rawTransaction),
  };
  const client = {
    transactions: {
      build: vi.fn(async () => transaction),
      send: vi.fn(async () => 'tx-signature'),
      track: vi.fn(async function* () {
        yield {
          executionResult: {
            userErrorCode: 0n,
            vmError: 0,
            executionResult: 0n,
          },
        };
      }),
      sendAndTrack: vi.fn(async function* () {
        yield {
          status: 2,
          signature: { value: signatureBytes },
          executionResult: {
            userErrorCode: 0n,
            vmError: 0,
            executionResult: 0n,
          },
        };
      }),
    },
  } as unknown as ThruClient;

  return { client, transaction, rawTransaction, signatureBytes };
}

describe('passkey submit', () => {
  it('builds and signs a passkey transaction with explicit header overrides', async () => {
    const { client, rawTransaction, transaction } = createClient();

    const result = await buildPasskeyTransaction({
      client,
      adminPublicKey: new Uint8Array(32).fill(1),
      adminPrivateKey: new Uint8Array(32).fill(2),
      walletAddress: 'wallet-address',
      accountCtx,
      targetProgramAddress: 'target-program',
      instructionData: new Uint8Array([3, 4]),
      header: {
        fee: 0n,
        nonce: 42n,
      },
      ...signaturePayload,
    });

    expect(client.transactions.build).toHaveBeenCalledWith(expect.objectContaining({
      program: 'passkey-program',
      accounts: {
        readWrite: ['lookup-address', 'wallet-address'],
        readOnly: ['readonly-address'],
      },
      header: {
        fee: 0n,
        nonce: 42n,
      },
      instructionData: new Uint8Array([1, 2]),
    }));
    expect(passkeyManagerMocks.decodeAddress).toHaveBeenCalledWith('target-program');
    expect(passkeyManagerMocks.encodeValidateInstruction).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAccountIdx: 3,
        authIdx: 0,
        targetInstruction: {
          programIdx: 4,
          instructionData: new Uint8Array([3, 4]),
        },
      })
    );
    expect(transaction.sign).toHaveBeenCalledWith(new Uint8Array(32).fill(2));
    expect(result.rawTransaction).toEqual(rawTransaction);
  });

  it('submits and tracks passkey transactions through one streaming RPC', async () => {
    const { client, rawTransaction, signatureBytes } = createClient();

    await expect(submitPasskeyTransaction({
      client,
      adminPublicKey: new Uint8Array(32).fill(1),
      adminPrivateKey: new Uint8Array(32).fill(2),
      walletAddress: 'wallet-address',
      accountCtx,
      targetProgramAddress: 'target-program',
      instructionData: new Uint8Array([3, 4]),
      ...signaturePayload,
    })).resolves.toEqual({
      signature: encodeSignature(signatureBytes),
      status: 'finalized',
      errorCode: 0n,
    });

    expect(client.transactions.sendAndTrack).toHaveBeenCalledWith(rawTransaction, {
      timeoutMs: 5000,
    });
    expect(client.transactions.send).not.toHaveBeenCalled();
    expect(client.transactions.track).not.toHaveBeenCalled();
  });
});
