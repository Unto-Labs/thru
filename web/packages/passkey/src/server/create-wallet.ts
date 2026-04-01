import {
  PASSKEY_MANAGER_PROGRAM_ADDRESS,
  base64UrlToBytes,
  buildAccountContext,
  createCredentialLookupSeed,
  createWalletSeed,
  deriveCredentialLookupAddress,
  deriveWalletAddress,
  encodeCreateInstruction,
  encodeRegisterCredentialInstruction,
} from '@thru/passkey-manager';
import { toThruAddress, getStateProof, trackTransaction } from './utils';
import type { ThruClient } from './types';

export async function createPasskeyWallet(opts: {
  client: ThruClient;
  adminPublicKey: Uint8Array;
  adminPrivateKey: string;
  adminAddress: string;
  pubkeyX: Uint8Array;
  pubkeyY: Uint8Array;
  credentialId?: string;
  walletName?: string;
}): Promise<{ walletAddress: string; credentialLookupAddress?: string }> {
  const walletName = opts.walletName ?? 'default';
  const seed = await createWalletSeed(walletName, opts.pubkeyX, opts.pubkeyY);
  const walletBytes = await deriveWalletAddress(seed, PASSKEY_MANAGER_PROGRAM_ADDRESS);
  const walletAddress = toThruAddress(walletBytes);

  let walletExists = false;
  try {
    await opts.client.accounts.get(walletAddress);
    walletExists = true;
  } catch {
    walletExists = false;
  }

  if (!walletExists) {
    const stateProof = await getStateProof(opts.client, walletAddress);
    const accountCtx = buildAccountContext({
      walletAddress,
      readWriteAccounts: [],
      readOnlyAccounts: [],
      feePayerAddress: opts.adminAddress,
      programAddress: PASSKEY_MANAGER_PROGRAM_ADDRESS,
    });

    const createIx = encodeCreateInstruction({
      walletAccountIdx: accountCtx.walletAccountIdx,
      authority: {
        tag: 1,
        pubkeyX: opts.pubkeyX,
        pubkeyY: opts.pubkeyY,
      },
      seed,
      stateProof,
    });

    const transaction = await opts.client.transactions.build({
      feePayer: { publicKey: opts.adminPublicKey },
      program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
      instructionData: createIx,
      accounts: {
        readWrite: [walletAddress],
        readOnly: [],
      },
      header: { fee: 0n },
    });

    await transaction.sign(opts.adminPrivateKey);
    const signature = await opts.client.transactions.send(transaction.toWire());
    const result = await trackTransaction(opts.client, signature, 60000);
    if (result.status !== 'finalized') {
      throw new Error(
        `Wallet creation failed with error code: ${result.errorCode ?? 'unknown'}`
      );
    }
  }

  let credentialLookupAddress: string | undefined;
  if (opts.credentialId) {
    const credentialIdBytes = base64UrlToBytes(opts.credentialId);
    const lookupAddressBytes = await deriveCredentialLookupAddress(
      credentialIdBytes,
      walletName,
      PASSKEY_MANAGER_PROGRAM_ADDRESS
    );

    credentialLookupAddress = toThruAddress(lookupAddressBytes);

    let lookupExists = false;
    try {
      await opts.client.accounts.get(credentialLookupAddress);
      lookupExists = true;
    } catch {
      lookupExists = false;
    }

    if (!lookupExists) {
      try {
        const credSeed = await createCredentialLookupSeed(credentialIdBytes, walletName);
        const stateProof = await getStateProof(opts.client, credentialLookupAddress);
        const accountCtx = buildAccountContext({
          walletAddress,
          readWriteAccounts: [lookupAddressBytes],
          readOnlyAccounts: [],
          feePayerAddress: opts.adminAddress,
          programAddress: PASSKEY_MANAGER_PROGRAM_ADDRESS,
        });

        const registerIx = encodeRegisterCredentialInstruction({
          walletAccountIdx: accountCtx.walletAccountIdx,
          lookupAccountIdx: accountCtx.getAccountIndex(lookupAddressBytes),
          seed: credSeed,
          stateProof,
        });

        const transaction = await opts.client.transactions.build({
          feePayer: { publicKey: opts.adminPublicKey },
          program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
          instructionData: registerIx,
          accounts: {
            readWrite: [walletAddress, credentialLookupAddress],
            readOnly: [],
          },
          header: { fee: 0n },
        });

        await transaction.sign(opts.adminPrivateKey);
        const signature = await opts.client.transactions.send(transaction.toWire());
        const result = await trackTransaction(opts.client, signature, 60000);
        if (result.status !== 'finalized') {
          throw new Error(
            `Credential registration failed with status: ${result.status}${
              result.errorCode !== undefined ? ` (error code: ${result.errorCode})` : ''
            }`
          );
        }
      } catch (error) {
        console.warn('Credential registration failed (non-fatal):', error);
      }
    }
  }

  return {
    walletAddress,
    credentialLookupAddress,
  };
}
