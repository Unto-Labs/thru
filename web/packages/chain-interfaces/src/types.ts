export const AddressType = {
  THRU: 'thru',
} as const;

export type AddressType = typeof AddressType[keyof typeof AddressType];

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
  status?: 'pending' | 'completed';
  metadata?: AppMetadata;
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
