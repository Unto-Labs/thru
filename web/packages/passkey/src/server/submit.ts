import {
  PASSKEY_MANAGER_PROGRAM_ADDRESS,
  decodeAddress,
  encodeValidateInstruction,
  hexToBytes,
} from '@thru/programs/passkey-manager';
import type { AccountContext } from '@thru/programs/passkey-manager';
import { sendAndTrackTransaction, withSerializedFeePayer } from './utils';
import type {
  BuiltPasskeyTransaction,
  PasskeySignaturePayload,
  PasskeyTransactionHeaderOverrides,
  ThruClient,
  TransactionResult,
} from './types';

function base64ToBytes(base64: string): Uint8Array {
  type BufferLike = {
    from(value: string, encoding: 'base64'): Uint8Array;
  };
  const globalBuffer = (globalThis as { Buffer?: BufferLike }).Buffer;
  if (globalBuffer) {
    return globalBuffer.from(base64, 'base64');
  }

  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  throw new Error('Base64 decoding is not supported in this environment');
}

/**
 * Builds and signs a passkey-manager transaction without submitting it.
 *
 * Callers that override the transaction nonce are responsible for coordinating
 * fee-payer nonce allocation before calling this helper. Use
 * `submitPasskeyTransaction` for the serialized one-off submit path.
 */
export async function buildPasskeyTransaction(opts: {
  client: ThruClient;
  adminPublicKey: Uint8Array;
  adminPrivateKey: Uint8Array;
  walletAddress: string;
  accountCtx: AccountContext;
  targetProgramAddress: string;
  instructionData: Uint8Array;
  authIdx?: number;
  header?: PasskeyTransactionHeaderOverrides;
} & PasskeySignaturePayload): Promise<BuiltPasskeyTransaction> {
  const targetProgramIdx = opts.accountCtx.getAccountIndex(
    decodeAddress(opts.targetProgramAddress)
  );
  const validateIx = encodeValidateInstruction({
    walletAccountIdx: opts.accountCtx.walletAccountIdx,
    authIdx: opts.authIdx ?? 0,
    targetInstruction: {
      programIdx: targetProgramIdx,
      instructionData: opts.instructionData,
    },
    signatureR: hexToBytes(opts.signatureR),
    signatureS: hexToBytes(opts.signatureS),
    authenticatorData: base64ToBytes(opts.authenticatorData),
    clientDataJSON: base64ToBytes(opts.clientDataJSON),
  });

  const transaction = await opts.client.transactions.build({
    feePayer: { publicKey: opts.adminPublicKey },
    program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
    instructionData: validateIx,
    accounts: {
      readWrite: opts.accountCtx.readWriteAddresses,
      readOnly: opts.accountCtx.readOnlyAddresses,
    },
    header: {
      fee: 0n,
      ...opts.header,
    },
  });

  await transaction.sign(opts.adminPrivateKey);
  return {
    transaction,
    rawTransaction: transaction.toWire(),
  };
}

export async function submitPasskeyTransaction(opts: {
  client: ThruClient;
  adminPublicKey: Uint8Array;
  adminPrivateKey: Uint8Array;
  walletAddress: string;
  accountCtx: AccountContext;
  targetProgramAddress: string;
  instructionData: Uint8Array;
  authIdx?: number;
  header?: PasskeyTransactionHeaderOverrides;
} & PasskeySignaturePayload): Promise<TransactionResult> {
  return withSerializedFeePayer(opts.adminPublicKey, async () => {
    const { rawTransaction } = await buildPasskeyTransaction(opts);
    return sendAndTrackTransaction(opts.client, rawTransaction);
  });
}
