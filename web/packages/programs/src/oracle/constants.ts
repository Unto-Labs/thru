/** Account discriminators (byte 0 of every Oracle account). Values are never
    reused; a new layout takes the next value. */
export const ORACLE_ACCOUNT_TYPE_PRICE_FEED_V1 = 1;
export const ORACLE_ACCOUNT_TYPE_BOOL_FEED_V1 = 2;

export const ORACLE_FEED_TYPE_PRICE = 1;
export const ORACLE_FEED_TYPE_BOOLEAN = 2;

export const ORACLE_EVENT_TYPE_PRICE_UPDATE = 1;
export const ORACLE_EVENT_TYPE_BOOLEAN_UPDATE = 2;

export const ORACLE_FEED_SEED_LENGTH = 32;
