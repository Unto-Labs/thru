import {
  PASSKEY_MANAGER_PROGRAM_ADDRESS,
  base64UrlToBytes,
  buildAccountContext,
  createAuthorityRecord,
  createCredentialLookupSeed,
  createWalletSeed,
  deriveCredentialLookupAddress,
  deriveWalletAddress,
  encodeCreateInstruction,
  encodeRegisterCredentialInstruction,
} from '@thru/programs/passkey-manager';
import {
  toThruAddress,
  getStateProof,
  sendAndTrackTransaction,
  withSerializedFeePayer,
} from "./utils";
import type { ThruClient } from "./types";

export async function createPasskeyWallet(opts: {
  client: ThruClient;
  adminPublicKey: Uint8Array;
  adminPrivateKey: Uint8Array;
  adminAddress: string;
  pubkeyX: Uint8Array;
  pubkeyY: Uint8Array;
  credentialId?: string;
  walletName?: string;
}): Promise<{ walletAddress: string; credentialLookupAddress?: string }> {
  const walletName = opts.walletName ?? "default";
  const seed = await createWalletSeed(walletName, opts.pubkeyX, opts.pubkeyY);
  const walletBytes = await deriveWalletAddress(
    seed,
    PASSKEY_MANAGER_PROGRAM_ADDRESS,
  );
  const walletAddress = toThruAddress(walletBytes);

  await withSerializedFeePayer(opts.adminPublicKey, async () => {
    let walletExists = false;
    try {
      await opts.client.accounts.get(walletAddress);
      walletExists = true;
    } catch {
      walletExists = false;
    }

    if (walletExists) return;

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
      authorityRecord: createAuthorityRecord({
        tag: 1,
        pubkeyX: opts.pubkeyX,
        pubkeyY: opts.pubkeyY,
      }),
      seed,
      stateProof,
    });

    const transaction = await opts.client.transactions.build({
      feePayer: { publicKey: opts.adminPublicKey },
      program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
      instructionData: createIx,
      accounts: {
        readWrite: accountCtx.readWriteAddresses,
        readOnly: accountCtx.readOnlyAddresses,
      },
      header: { fee: 0n },
    });

    await transaction.sign(opts.adminPrivateKey);
    const result = await sendAndTrackTransaction(
      opts.client,
      transaction.toWire(),
      60000,
    );
    if (result.status !== "finalized") {
      throw new Error(
        `Wallet creation failed with status: ${result.status}${
          result.errorCode !== undefined
            ? ` (error code: ${result.errorCode})`
            : ""
        }`,
      );
    }
  });

  let credentialLookupAddress: string | undefined;
  if (opts.credentialId) {
    const credentialIdBytes = base64UrlToBytes(opts.credentialId);
    const lookupAddressBytes = await deriveCredentialLookupAddress(
      credentialIdBytes,
      PASSKEY_MANAGER_PROGRAM_ADDRESS,
    );
    const lookupAddress = toThruAddress(lookupAddressBytes);

    credentialLookupAddress = lookupAddress;

    try {
      await withSerializedFeePayer(opts.adminPublicKey, async () => {
        let lookupExists = false;
        try {
          await opts.client.accounts.get(lookupAddress);
          lookupExists = true;
        } catch {
          lookupExists = false;
        }

        if (lookupExists) return;

        const credSeed = await createCredentialLookupSeed(credentialIdBytes);
        const stateProof = await getStateProof(opts.client, lookupAddress);
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
            readWrite: accountCtx.readWriteAddresses,
            readOnly: accountCtx.readOnlyAddresses,
          },
          header: { fee: 0n },
        });

        await transaction.sign(opts.adminPrivateKey);
        const result = await sendAndTrackTransaction(
          opts.client,
          transaction.toWire(),
          60000,
        );
        if (result.status !== "finalized") {
          throw new Error(
            `Credential registration failed with status: ${result.status}${
              result.errorCode !== undefined
                ? ` (error code: ${result.errorCode})`
                : ""
            }`,
          );
        }
      });
    } catch (error) {
      console.warn("Credential registration failed (non-fatal):", error);
    }
  }

  return {
    walletAddress,
    credentialLookupAddress,
  };
}
