/* Add-passkey-to-account transaction builder, lifted from
   `web/wallet-auth-manager/app/page.tsx` (`runValidateThen`,
   `handleSubmitAddPasskey`) so the wallet's `/embedded` post-connect
   step can reuse the exact same flow.

   Builds the on-chain transaction:
     VALIDATE(existingAuthority) + ADD_AUTHORITY(newPasskey) [+ REGISTER_CREDENTIAL]
   asks the caller's existing passkey to sign the challenge, then asks
   the caller's wallet signer to sign the assembled transaction, sends
   it, and returns the result. */

import {
  type Authority,
  buildAccountContext,
  concatenateInstructions,
  createValidateChallenge,
  createCredentialLookupSeed,
  deriveWalletAddress,
  encodeAddAuthorityInstruction,
  encodeRegisterCredentialInstruction,
  encodeValidateInstruction,
  parseWalletAuthorities,
  type ParsedAuthority,
  type WalletSigner,
} from "@thru/programs/passkey-manager";

/** Minimal shape required from a passkey signer. Both web's
    `signWithDiscoverablePasskey`/`signWithPasskey` and mobile's
    counterparts conform. */
export interface PasskeyChallengeSigner {
  signChallenge: (challenge: Uint8Array) => Promise<{
    signatureR: Uint8Array;
    signatureS: Uint8Array;
    authenticatorData: Uint8Array;
    clientDataJSON: Uint8Array;
  }>;
}

/** Minimal shape required from a Thru chain client. Loosely-typed
    because @thru/sdk's DTS emit is currently broken in this
    repo. The caller passes the real Thru and we narrow operationally. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyThruClient = any;

export interface AddDeviceParams {
  /** Loosely-typed Thru chain client (`@thru/sdk/client`). */
  thru: AnyThruClient;
  /** Wallet (the on-chain WalletAccount) to attach the passkey to. */
  walletAddress: string;
  /** Index of the existing authority that approves this change. Must
      currently be a passkey authority. */
  authIdx: number;
  /** New passkey to attach. tag = 1 (passkey). */
  newAuthority: Authority;
  /** Optional credential-lookup registration so the new passkey is
      discoverable on subsequent sign-ins. */
  credentialId?: Uint8Array;
  walletName?: string;
  /** Existing-passkey challenge signer (web or mobile). */
  passkey: PasskeyChallengeSigner;
  /** Wallet transaction signer that returns base64(signed bytes). */
  walletSigner: WalletSigner;
  /** Passkey program address (base58). */
  programAddress: string;
  /** Sign-and-send executor (lifted from passkey-transaction.ts in the
      wallet-auth-manager - wallet apps own this because it depends on
      the `Thru` client's transaction builder). */
  executor: TxExecutor;
  /** Optional status callback so UIs can show progress. */
  onStatus?: (message: string) => void;
}

export interface TxExecutorParams {
  thru: AnyThruClient;
  walletSigner: WalletSigner;
  instructionData: Uint8Array;
  readWriteAddresses: string[];
  readOnlyAddresses: string[];
  label: string;
}

export interface TxExecutorResult {
  signature: string;
  /** Loosely-typed because @thru/sdk types aren't available. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execution: any;
}

export type TxExecutor = (
  params: TxExecutorParams,
) => Promise<TxExecutorResult>;

export interface AddDeviceResult extends TxExecutorResult {
  /** The new passkey's authority index after the transaction lands. */
  newAuthorityIdx: number;
}

/**
 * Run VALIDATE + ADD_AUTHORITY [+ REGISTER_CREDENTIAL] to attach a new
 * passkey to an on-chain WalletAccount.
 */
export async function addDeviceToAccount(
  params: AddDeviceParams,
): Promise<AddDeviceResult> {
  const status = params.onStatus ?? (() => {});

  const walletAccount = await params.thru.accounts.get(params.walletAddress);
  const walletData: Uint8Array | undefined = walletAccount?.data?.data;
  if (!walletData) {
    throw new Error("Wallet account data missing");
  }

  const parsed = parseWalletAuthorities(walletData);
  const authorizing: ParsedAuthority | undefined =
    parsed.authorities[params.authIdx];
  if (!authorizing) {
    throw new Error("Authorization index out of bounds");
  }
  if (authorizing.kind !== "passkey") {
    throw new Error(
      "addDeviceToAccount currently requires a passkey authority for VALIDATE",
    );
  }

  /* The new authority will land at the next free slot. */
  const newAuthorityIdx = parsed.authorities.length;

  /* Build the instruction sequence after the VALIDATE. */
  const addAuthorityInstruction = encodeAddAuthorityInstruction({
    authority: params.newAuthority,
  });

  let trailingInstructionData = addAuthorityInstruction;
  let readWriteAccounts: Uint8Array[] = [];

  if (params.credentialId) {
    const lookupSeed = await createCredentialLookupSeed(params.credentialId);
    const lookupAddressBytes = await deriveWalletAddress(
      lookupSeed,
      params.programAddress,
    );

    status("Fetching state proof for credential lookup...");
    const proofResult = await params.thru.proofs.generate({
      proofType: 1 /* StateProofType.CREATING */,
      address: lookupAddressBytes,
    });

    const ctx = buildAccountContext({
      walletAddress: params.walletAddress,
      readWriteAccounts: [lookupAddressBytes],
      readOnlyAccounts: [],
    });

    const registerCredentialInstruction = encodeRegisterCredentialInstruction({
      walletAccountIdx: ctx.walletAccountIdx,
      lookupAccountIdx: ctx.getAccountIndex(lookupAddressBytes),
      seed: lookupSeed,
      stateProof: proofResult.proof,
    });

    trailingInstructionData = concatenateInstructions([
      addAuthorityInstruction,
      registerCredentialInstruction,
    ]);
    readWriteAccounts = [lookupAddressBytes];
  }

  /* Build the VALIDATE challenge over (nonce, account_addresses,
     trailing_instruction_data) and ask the caller's passkey to sign. */
  const ctx = buildAccountContext({
    walletAddress: params.walletAddress,
    readWriteAccounts,
    readOnlyAccounts: [],
  });

  const challenge = await createValidateChallenge(
    parsed.nonce,
    ctx.accountAddresses,
    trailingInstructionData,
  );

  status("Waiting for passkey approval...");
  const signature = await params.passkey.signChallenge(challenge);

  const validateInstruction = encodeValidateInstruction({
    walletAccountIdx: ctx.walletAccountIdx,
    authIdx: params.authIdx,
    signatureR: signature.signatureR,
    signatureS: signature.signatureS,
    authenticatorData: signature.authenticatorData,
    clientDataJSON: signature.clientDataJSON,
  });

  const instructionData = concatenateInstructions([
    validateInstruction,
    trailingInstructionData,
  ]);

  status("Sending transaction...");
  const result = await params.executor({
    thru: params.thru,
    walletSigner: params.walletSigner,
    instructionData,
    readWriteAddresses: ctx.readWriteAddresses,
    readOnlyAddresses: ctx.readOnlyAddresses,
    label: params.credentialId
      ? "VALIDATE + ADD_AUTHORITY + REGISTER_CREDENTIAL"
      : "VALIDATE + ADD_AUTHORITY",
  });

  return { ...result, newAuthorityIdx };
}
