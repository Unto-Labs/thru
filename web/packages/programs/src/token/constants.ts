export const PUBKEY_LENGTH = 32;
export const TICKER_MAX_LENGTH = 8;
export const ZERO_PUBKEY = new Uint8Array(PUBKEY_LENGTH);

/** Account discriminators (byte 0 of every Token Program account). Values are
    never reused; a new layout takes the next value. */
export const TOKEN_ACCOUNT_TYPE_MINT_V1 = 1;
export const TOKEN_ACCOUNT_TYPE_TOKEN_ACCOUNT_V1 = 2;
/** Mint account size: account_type + mint payload. */
export const TOKEN_MINT_ACCOUNT_SIZE = 116;
/** Token account size: account_type + token account payload. */
export const TOKEN_ACCOUNT_SIZE = 74;
