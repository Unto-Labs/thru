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

export interface ThruTransactionIntent {
  /** Maximum state growth in 4 KiB units, rounded per account. Defaults to 1. */
  stateUnits?: number;
  walletAddress?: string;
  programAddress: string;
  instructionData: string;
  readWriteAddresses?: string[];
  readOnlyAddresses?: string[];
  review?: ThruTransactionReviewPayload;
  /** @internal Used by ThruSigningSession handles. */
  signingSessionId?: string;
}
