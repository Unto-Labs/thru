import {
  PASSKEY_MANAGER_PROGRAM_ADDRESS,
  concatenateInstructions,
  encodeValidateInstruction,
  hexToBytes,
} from '@thru/passkey-manager';
import type { AccountContext } from '@thru/passkey-manager';
import { trackTransaction, withSerializedFeePayer } from './utils';
import type {
  BuiltPasskeyTransaction,
  PasskeySignaturePayload,
  PasskeyTransactionHeaderOverrides,
  ThruClient,
  TransactionResult,
} from './types';

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
  invokeIx: Uint8Array;
  header?: PasskeyTransactionHeaderOverrides;
} & PasskeySignaturePayload): Promise<BuiltPasskeyTransaction> {
  const validateIx = encodeValidateInstruction({
    walletAccountIdx: opts.accountCtx.walletAccountIdx,
    authIdx: 0,
    signatureR: hexToBytes(opts.signatureR),
    signatureS: hexToBytes(opts.signatureS),
    authenticatorData: Buffer.from(opts.authenticatorData, 'base64'),
    clientDataJSON: Buffer.from(opts.clientDataJSON, 'base64'),
  });

  const instructionData = concatenateInstructions([validateIx, opts.invokeIx]);
  const transaction = await opts.client.transactions.build({
    feePayer: { publicKey: opts.adminPublicKey },
    program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
    instructionData,
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
  invokeIx: Uint8Array;
  header?: PasskeyTransactionHeaderOverrides;
} & PasskeySignaturePayload): Promise<TransactionResult> {
  return withSerializedFeePayer(opts.adminPublicKey, async () => {
    const { rawTransaction } = await buildPasskeyTransaction(opts);
    const signature = await opts.client.transactions.send(rawTransaction);
    return trackTransaction(opts.client, signature);
  });
}
