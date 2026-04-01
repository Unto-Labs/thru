import {
  PASSKEY_MANAGER_PROGRAM_ADDRESS,
  concatenateInstructions,
  encodeValidateInstruction,
  hexToBytes,
} from '@thru/passkey-manager';
import type { AccountContext } from '@thru/passkey-manager';
import { trackTransaction } from './utils';
import type {
  PasskeySignaturePayload,
  ThruClient,
  TransactionResult,
} from './types';

export async function submitPasskeyTransaction(opts: {
  client: ThruClient;
  adminPublicKey: Uint8Array;
  adminPrivateKey: string;
  walletAddress: string;
  accountCtx: AccountContext;
  invokeIx: Uint8Array;
} & PasskeySignaturePayload): Promise<TransactionResult> {
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
    header: { fee: 0n },
  });

  await transaction.sign(opts.adminPrivateKey);
  const signature = await opts.client.transactions.send(transaction.toWire());
  return trackTransaction(opts.client, signature);
}
