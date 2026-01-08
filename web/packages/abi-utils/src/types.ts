/**
 * ABI account state values
 */
export const ABI_STATE = {
  OPEN: 0x00,
  FINALIZED: 0x01,
} as const;

export type AbiAccountState = (typeof ABI_STATE)[keyof typeof ABI_STATE];

/**
 * Parsed header from an ABI account's on-chain data
 */
export interface AbiAccountHeader {
  /** The program meta account this ABI is associated with */
  programMetaAccount: Uint8Array;
  /** Revision number (incremented on each upgrade) */
  revision: bigint;
  /** Account state: OPEN (0) or FINALIZED (1) */
  state: AbiAccountState;
  /** Size of the ABI content in bytes */
  contentSize: number;
}

/**
 * Full ABI account data including parsed YAML content
 */
export interface AbiAccountData extends AbiAccountHeader {
  /** Raw ABI YAML content bytes */
  contentBytes: Uint8Array;
  /** ABI YAML content as string */
  content: string;
}
