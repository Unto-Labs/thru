export type AccountLookupContext = {
  getAccountIndex: (pubkey: Uint8Array) => number;
};

export type InstructionData = (context: AccountLookupContext) => Promise<Uint8Array>;

export interface MintAccountInfo {
  decimals: number;
  supply: bigint;
  creator: string;
  mintAuthority: string;
  freezeAuthority: string | null;
  hasFreezeAuthority: boolean;
  ticker: string;
}

export interface TokenAccountInfo {
  mint: string;
  owner: string;
  amount: bigint;
  isFrozen: boolean;
}

export interface InitializeMintArgs {
  mintAccountBytes: Uint8Array;
  decimals: number;
  creatorBytes?: Uint8Array;
  mintAuthorityBytes: Uint8Array;
  freezeAuthorityBytes?: Uint8Array;
  ticker: string;
  seedHex: string;
  stateProof: Uint8Array;
}

export interface InitializeAccountArgs {
  tokenAccountBytes: Uint8Array;
  mintAccountBytes: Uint8Array;
  ownerAccountBytes: Uint8Array;
  seedBytes: Uint8Array;
  stateProof: Uint8Array;
}

export interface MintToArgs {
  mintAccountBytes: Uint8Array;
  destinationAccountBytes: Uint8Array;
  authorityAccountBytes: Uint8Array;
  amount: bigint;
}

export interface TransferArgs {
  sourceAccountBytes: Uint8Array;
  destinationAccountBytes: Uint8Array;
  amount: bigint;
}
