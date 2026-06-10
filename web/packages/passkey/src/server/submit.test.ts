import { describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '@thru/programs/passkey-manager';
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
  const transaction = {
    sign: vi.fn(async () => {}),
    toWire: vi.fn(() => new Uint8Array([9, 9, 9])),
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
    },
  } as unknown as ThruClient;

  return { client, transaction };
}

describe('passkey submit', () => {
  it('builds and signs a passkey transaction with explicit header overrides', async () => {
    const { client, transaction } = createClient();

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
    expect(result.rawTransaction).toEqual(new Uint8Array([9, 9, 9]));
  });

  it('keeps submitPasskeyTransaction as a send and track convenience wrapper', async () => {
    const { client } = createClient();

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
      signature: 'tx-signature',
      status: 'finalized',
      errorCode: 0n,
    });

    expect(client.transactions.send).toHaveBeenCalledWith(new Uint8Array([9, 9, 9]));
  });
});
