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
  /**
   * Maximum state growth in 4 KiB units, rounded per account. Defaults to 0:
   * set it for any transaction that creates or grows an account.
   */
  stateUnits?: number;
  walletAddress?: string;
  programAddress: string;
  instructionData: string;
  readWriteAddresses?: string[];
  readOnlyAddresses?: string[];
  review?: ThruTransactionReviewPayload;
  /**
   * The fee payer the instruction was built against: `feePayerPublicKey`
   * from the signing context (or a signing session's key). Account indices in
   * the instruction count from it (account 0). The wallet signs only with the
   * signer that pays from this account and refuses with `SIGNER_CHANGED`
   * otherwise, so a signer switch can never move account 0.
   */
  feePayerPublicKey?: string;
  /** @internal Used by ThruSigningSession handles. */
  signingSessionId?: string;
}
