import type { ContractTransactionReceipt, Log, Signer } from 'ethers';

export type PolygonSignerConfig =
  | {
      privateKey: string;
      rpcUrl: string;
    }
  | {
      signer: Signer;
      rpcUrl?: string;
    };

export interface ThruSignerConfig {
  baseUrl: string;
  feePayerAddress: string;
  feePayerPrivateKey: string;
}

export interface BridgeClientConfig {
  polygon?: {
    signer: PolygonSignerConfig;
    polygonBridgeAddress: string;
  };
  thru?: {
    signer: ThruSignerConfig;
    thruBridgeProgramAddress: string;
  };
}

export interface PolygonTokenMetadata {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface PolygonToThruDepositRequest {
  thruRecipient: string;
  polygonTokenAddress: string;
  rawAmount: bigint;
}

export interface PolygonTokenApprovalRequest {
  polygonTokenAddress: string;
  rawAmount: bigint;
}

export interface PolygonDepositEvent {
  sequence: bigint;
  sourceChainId: number;
  destChainId: number;
  polygonTokenAddress: string;
  polygonDepositorAddress: string;
  thruRecipientBytes32: string;
  thruRecipient: string | null;
  amountRaw: bigint;
  polygonTokenName: string;
  polygonTokenSymbol: string;
  polygonTokenDecimals: number;
  polygonTxHash: string;
  polygonBlockNumber: number;
  polygonLogIndex: number;
  matchesConfiguredRoute: boolean;
}

export interface PolygonToThruDepositResult {
  polygonTxHash: string;
  amountRaw: bigint;
  thruRecipient: string;
  thruRecipientBytes32: string;
  polygonReceipt: ContractTransactionReceipt;
  polygonDepositEvent: PolygonDepositEvent | null;
}

export interface PolygonTokenApprovalResult {
  polygonTxHash: string;
  amountRaw: bigint;
  polygonReceipt: ContractTransactionReceipt;
}

export interface ThruToPolygonDepositRequest {
  thruTokenMintAddress: string;
  polygonRecipientAddress: string;
  rawAmount: bigint;
  thruTokenAccountAddress?: string;
  payloadHex?: string;
}

export interface ThruPolygonTokenRoute {
  thruTokenMintAddress: string;
  thruMetadataAccountAddress: string;
  destinationChainId: number;
  polygonTokenAddressBytes32: string;
  polygonTokenAddress: string | null;
  isPolygonBridgedToken: boolean;
}

export interface ThruToPolygonDepositResult {
  thruSignature: string;
  rawAmount: bigint;
  thruTokenMintAddress: string;
  thruTokenAccountAddress: string;
  thruMetadataAccountAddress: string;
  bridgeManagerAddress: string;
  feeCollectorAddress: string;
  feeVaultTokenAccountAddress: string;
  polygonTokenAddress: string;
  polygonRecipientAddress: string;
  polygonRecipientBytes32: string;
}

export type DepositLogInput = Pick<Log, 'address' | 'topics' | 'data' | 'transactionHash' | 'blockNumber' | 'index'>;
