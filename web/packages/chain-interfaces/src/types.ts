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
