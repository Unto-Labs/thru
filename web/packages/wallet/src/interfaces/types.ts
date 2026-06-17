export const AddressType = {
  THRU: "thru",
} as const;

export type AddressType = (typeof AddressType)[keyof typeof AddressType];

export interface WalletAccount {
  accountType: AddressType;
  address: string;
  label: string;
}

export interface AppMetadata {
  appId: string;
  appName: string;
  appUrl: string;
  imageUrl?: string;
}

export interface ConnectResult {
  walletId?: string;
  accounts: WalletAccount[];
  selectedAccount?: WalletAccount | null;
  status?: "pending" | "completed";
  metadata?: AppMetadata;
}

export const ThruTransactionEncoding = {
  SIGNING_PAYLOAD_BASE64: "signing_payload_base64",
  RAW_TRANSACTION_BASE64: "raw_transaction_base64",
} as const;

export type ThruTransactionEncoding =
  (typeof ThruTransactionEncoding)[keyof typeof ThruTransactionEncoding];

export interface ThruSigningContext {
  mode: "managed_fee_payer";
  selectedAccountPublicKey: string | null;
  feePayerPublicKey: string;
  signerPublicKey: string;
  acceptedInputEncodings: ThruTransactionEncoding[];
  outputEncoding: typeof ThruTransactionEncoding.RAW_TRANSACTION_BASE64;
}

export interface ThruTransactionReviewSimulation {
  before?: string;
  after?: string;
}

export interface ThruTransactionReviewAbiReflection {
  label?: string;
  kind?: string | null;
  typeName?: string;
  value?: unknown;
  rawHex?: string;
  source?: string;
  error?: string;
}

export interface ThruTransactionReviewPayload {
  appName?: string;
  programAddress?: string;
  abiName?: string;
  instruction?: string;
  simulation?: ThruTransactionReviewSimulation;
  abiReflection?: ThruTransactionReviewAbiReflection;
}

export type ThruSigningSessionTimestamp = Date | number | bigint | string;

export interface ThruSigningSessionCreateOptions {
  walletAddress?: string;
  durationSeconds?: number;
  expiresAt?: ThruSigningSessionTimestamp;
  review?: ThruTransactionReviewPayload;
}

export interface ThruSigningSessionInstructionCreateOptions extends Omit<
  ThruSigningSessionCreateOptions,
  "review"
> {
  walletAccountIdx: number;
}

export interface ThruSigningSessionDescriptor {
  id: string;
  walletAddress: string;
  publicKey: string;
  authIdx: number;
  expiresAt: number;
  createdAt: number;
}

export interface ThruSigningSession extends ThruSigningSessionDescriptor {
  signTransaction(transaction: ThruTransactionIntent): Promise<string>;
  revoke(): Promise<void>;
  toJSON(): ThruSigningSessionDescriptor;
}

export interface ThruSigningSessionInstruction {
  session: ThruSigningSession;
  programAddress: string;
  instructionData: Uint8Array;
}

export interface ThruTransactionIntent {
  walletAddress?: string;
  programAddress: string;
  instructionData: string;
  readWriteAddresses?: string[];
  readOnlyAddresses?: string[];
  review?: ThruTransactionReviewPayload;
  /** @internal Used by ThruSigningSession handles. */
  signingSessionId?: string;
}

export interface ThruPasskeyChallengeIntent {
  /** base64url-encoded passkey-manager challenge bytes. */
  challenge: string;
  walletAddress?: string;
}

export interface ThruPasskeyChallengeSignature {
  signatureR: string;
  signatureS: string;
  authenticatorData: string;
  clientDataJSON: string;
}

export interface ConnectedApp {
  accountId: number;
  appId: string;
  origin: string;
  metadata: AppMetadata;
  connectedAt: number;
  updatedAt: number;
}

export interface SignMessageParams {
  message: string | Uint8Array;
  networkId: string;
}

export interface SignMessageResult {
  signature: Uint8Array;
  publicKey: string;
}
