import { TransactionVmError } from '@thru/sdk/proto';

/* Program and runtime errors, named.

   A failed perp transaction carries a VM error (the runtime's
   TransactionVmError: SU_EXHAUSTED, NONCE_TOO_LOW, ...) and, when the
   program reverted, a user error code from tn_perp_program/errors.h (the
   spot CLOB's table plus the perp codes -205..-234 and -403).  The table
   below is that header (errors.test.ts checks it against the C source). */

export const PERP_ERROR_CODES = {
  INVALID_INSTR_SIZE: -101,
  INVALID_INSTR_TYPE: -102,
  INVALID_EXCHANGE_INIT_PROOF_SIZE: -103,
  INVALID_STATUS_FLAGS: -104,
  INDIVISIBLE_PRICE_TICKS: -201,
  INDIVISIBLE_QTY_LOTS: -202,
  OVER_MAX_PRICE: -203,
  INVALID_LOT_OR_TICK_SIZE: -204,
  PRICE_ABOVE_CAP: -205,
  INVALID_PRICE_CAP: -206,
  INVALID_POSITION_LIMIT: -207,
  POSITION_LIMIT: -208,
  ARITH_OVERFLOW: -209,
  ORACLE_MISSING: -210,
  ORACLE_MISMATCH: -211,
  ORACLE_INVALID: -212,
  ORACLE_STALE: -213,
  INVALID_MARGIN_PARAMS: -214,
  NOT_LIQUIDATABLE: -215,
  SELF_LIQUIDATION: -216,
  FUNDING_DISABLED: -217,
  INVALID_FUNDING_PARAMS: -218,
  FUNDING_UPDATE_NOT_ALONE: -219,
  MARGIN_ACCOUNT_MISSING: -220,
  MARGIN_LINK_MISMATCH: -221,
  MARGIN_LINK_LIMIT: -222,
  MARGIN_ALREADY_LINKED: -223,
  MARGIN_VAULT_MISMATCH: -224,
  MARGIN_SEAT_NOT_FLAT: -225,
  MARGIN_ACCOUNT_INVALID: -226,
  MARGIN_UNAUTHORIZED: -227,
  INVALID_CROSS_PARAMS: -228,
  NOTHING_RESOLVED: -229,
  RISK_PARAM_INVALID: -230,
  FEE_PARAM_INVALID: -231,
  FEE_SEAT: -232,
  BUILDER_INVALID: -233,
  FEE_CLAIM_BLOCKED: -234,
  GTT_ORDER_EXPIRED: -301,
  ORDER_ID_NOT_FOUND: -302,
  CLIENT_ID_NOT_FOUND: -303,
  MODIFY_INCREASE_NOT_ALLOWED: -304,
  ASK_BID_SIDE_UNDEF: -305,
  CBOOK_FULL: -306,
  OB_SIDE_STATE_MISMATCH: -308,
  INSUFFICIENT_FUNDS_QUOTE: -401,
  INSUFFICIENT_COLLATERAL: -403,
  MARKET_DEPOSITS_FROZEN: -501,
  MARKET_WITHDRAWALS_FROZEN: -502,
  MARKET_PAUSED: -503,
  MARKET_POSTONLY_MODE: -504,
  SEAT_NOT_FOUND: -601,
  SEAT_ARENA_DATA_NOT_FOUND: -602,
  SEAT_ARENA_FULL: -603,
  ENTRY_IDX_OUT_OF_BOUNDS: -604,
  RESERVED_SEAT_IDX: -605,
  ARENA_ENTRY_NOT_ACTIVE: -606,
  ARENA_FULL: -607,
  INVALID_ACCOUNT_MAGIC: -701,
  INVALID_ACCOUNT_IDX: -702,
  INVALID_VAULT_PUBKEY: -703,
  EXCHANGE_META_INVALID_IDX: -704,
  EXCHANGE_META_NOT_FOUND: -705,
  EXCHANGE_META_WRONG_OWNER: -706,
  EXCHANGE_META_INVALID_SIZE: -707,
  EXCHANGE_META_INVALID_MAGIC: -708,
  EXCHANGE_META_INVALID_VERSION: -709,
  PROGRAM_META_INVALID_IDX: -710,
  PROGRAM_META_NOT_FOUND: -711,
  PROGRAM_META_WRONG_OWNER: -712,
  PROGRAM_META_INVALID_SIZE: -713,
  TOKEN_PROGRAM_INVALID_IDX: -714,
  TOKEN_PROGRAM_NOT_FOUND: -715,
  TOKEN_ACCOUNT_NOT_PROGRAM: -716,
  TOKEN_PROGRAM_NOT_CANONICAL: -717,
  MISMATCH_PUBKEY: -801,
  MISMATCH_TOKEN_PROGRAM_PUBKEY: -802,
  MISMATCH_SEAT_AUTH_PUBKEY: -803,
  MISMATCH_QUOTE_VAULT_PUBKEY: -805,
  MISMATCH_MARKET_AUTH_PUBKEY: -806,
  MISMATCH_ORDER_ARENA_PUBKEY: -807,
  MISMATCH_BIDS_CBOOK_PUBKEY: -808,
  MISMATCH_ASKS_CBOOK_PUBKEY: -809,
  MISMATCH_EXCHANGE_META_PUBKEY: -810,
  MISMATCH_PROGRAM_PUBKEY: -811,
  UNAUTHORIZED_SEAT_AUTH: -901,
  UNAUTHORIZED_MARKET_AUTH: -902,
  UNAUTHORIZED_WALLET_OWNER: -903,
  EXCHANGE_AUTH_INVALID_IDX: -904,
  EXCHANGE_AUTH_NOT_SIGNER: -905,
  EXCHANGE_AUTH_MISMATCH: -906,
  EXCHANGE_ADMIN_INVALID_IDX: -907,
  EXCHANGE_ADMIN_NOT_SIGNER: -908,
  EXCHANGE_ADMIN_MISMATCH: -909,
  NEW_EXCHANGE_ADMIN_INVALID_IDX: -910,
  INVALID_MARKET_RECORD_IDX: -1001,
  MARKET_RECORD_MISSING_SEAT_AUTHORITY: -1002,
  MARKET_RECORD_MISSING_SEAT_ARENA: -1003,
  MARKET_RECORD_MISSING_MARKET_AUTH: -1004,
  MARKET_RECORD_MISMATCH_SEAT_IDX: -1006,
} as const;

export type PerpErrorName = keyof typeof PERP_ERROR_CODES;

const NAME_BY_CODE = new Map<number, PerpErrorName>(
  (Object.entries(PERP_ERROR_CODES) as Array<[PerpErrorName, number]>).map(([name, code]) => [code, name]),
);

/** What kind of failure an error is: callers (and agents) branch on this. */
export type PerpErrorKind =
  | 'insufficient-margin'
  | 'oracle'
  | 'state-units'
  | 'nonce'
  | 'market-status'
  | 'order-not-found'
  | 'invalid-order'
  | 'position-limit'
  | 'margin-account'
  | 'funding'
  | 'liquidation'
  | 'unauthorized'
  | 'seat'
  | 'invalid-transaction'
  | 'timeout'
  | 'unknown';

const TEXT: Partial<Record<PerpErrorName, string>> = {
  INDIVISIBLE_PRICE_TICKS: 'price must be a multiple of the market tick size',
  INDIVISIBLE_QTY_LOTS: 'size must be a multiple of the market lot size',
  OVER_MAX_PRICE: 'price is above the maximum this market allows',
  PRICE_ABOVE_CAP: 'price is above the market price cap',
  POSITION_LIMIT: 'this order would exceed the market position limit',
  ARITH_OVERFLOW: 'arithmetic overflow — reduce the size',
  ORACLE_MISSING: "oracle feed missing — the transaction did not carry the market's feed account",
  ORACLE_MISMATCH: 'oracle feed mismatch — the feed account is not the one the market pins',
  ORACLE_INVALID: 'oracle feed invalid — wrong type, exponent or a zero mark',
  ORACLE_STALE: 'oracle feed is stale — the mark cannot be read until it updates',
  INVALID_MARGIN_PARAMS: 'invalid margin parameters (1 <= maintenance < initial <= 10000 bps, fee <= 10000 bps)',
  NOT_LIQUIDATABLE: 'that seat is not liquidatable — its equity covers the maintenance margin',
  SELF_LIQUIDATION: 'a seat cannot liquidate itself',
  FUNDING_DISABLED: 'funding is disabled on this market',
  INVALID_FUNDING_PARAMS: 'invalid funding parameters',
  FUNDING_UPDATE_NOT_ALONE: 'funding_update cannot share a transaction with an order or cancel',
  MARGIN_ACCOUNT_MISSING: "the seat is cross-margined and the transaction carries no margin record for its account",
  MARGIN_LINK_MISMATCH: "the margin record does not list the account's links in order, or a link is not the owner's cross seat",
  MARGIN_LINK_LIMIT: 'the margin account already links the maximum number of markets',
  MARGIN_ALREADY_LINKED: 'the seat is already linked, or the account already links this market',
  MARGIN_VAULT_MISMATCH: "the market's quote vault is not the margin account's vault",
  MARGIN_SEAT_NOT_FLAT: 'only a flat seat (no position, no resting orders) can be unlinked',
  MARGIN_ACCOUNT_INVALID: 'the account is not a margin account of this program',
  MARGIN_UNAUTHORIZED: 'the signer is not the margin account owner',
  INVALID_CROSS_PARAMS: 'invalid cross margin parameters',
  NOTHING_RESOLVED: 'nothing to resolve: no fees, insurance or open positions can cover the bad debt now',
  RISK_PARAM_INVALID: 'invalid loss waterfall parameters (or an insurance deposit of 0)',
  FEE_PARAM_INVALID: 'invalid fee rates (taker fee and builder cap <= 10000 ppm, rebate <= taker fee, shares <= 100%), or a fee claim of 0',
  FEE_SEAT: 'a fee seat cannot trade, rest orders, link or liquidate; only a flat isolated seat without orders can become one',
  BUILDER_INVALID: "the builder is not a fee seat of this market, belongs to the trader's own wallet, or its rate is above 10000 ppm",
  FEE_CLAIM_BLOCKED: 'protocol fees cannot be claimed while the market has bad debt, or the claim exceeds the fee balance',
  GTT_ORDER_EXPIRED: 'the order expired',
  ORDER_ID_NOT_FOUND: 'order not found — it may have already filled or been cancelled',
  CLIENT_ID_NOT_FOUND: 'order not found — it may have already filled or been cancelled',
  MODIFY_INCREASE_NOT_ALLOWED: 'a modify can only reduce an order',
  CBOOK_FULL: 'this side of the book is full — try again shortly',
  INSUFFICIENT_FUNDS_QUOTE: 'insufficient free collateral — the amount exceeds what is withdrawable',
  INSUFFICIENT_COLLATERAL: 'insufficient collateral — free margin would go negative; deposit more or reduce the size',
  MARKET_DEPOSITS_FROZEN: 'deposits are currently frozen on this market',
  MARKET_WITHDRAWALS_FROZEN: 'withdrawals are currently frozen on this market',
  MARKET_PAUSED: 'this market is paused',
  MARKET_POSTONLY_MODE: 'this market is only accepting post-only orders right now',
  SEAT_NOT_FOUND: 'no seat found for this wallet — create a seat first',
  SEAT_ARENA_FULL: 'this market has no free seats left',
  ARENA_ENTRY_NOT_ACTIVE: 'that order is no longer active — it may have filled or been cancelled',
  ARENA_FULL: 'the order arena is full — try again shortly',
  UNAUTHORIZED_SEAT_AUTH: 'this wallet does not own that seat',
  UNAUTHORIZED_MARKET_AUTH: 'the signer is not the market authority',
};

const KIND: Partial<Record<PerpErrorName, PerpErrorKind>> = {
  INSUFFICIENT_COLLATERAL: 'insufficient-margin',
  INSUFFICIENT_FUNDS_QUOTE: 'insufficient-margin',
  ORACLE_MISSING: 'oracle',
  ORACLE_MISMATCH: 'oracle',
  ORACLE_INVALID: 'oracle',
  ORACLE_STALE: 'oracle',
  MARKET_DEPOSITS_FROZEN: 'market-status',
  MARKET_WITHDRAWALS_FROZEN: 'market-status',
  MARKET_PAUSED: 'market-status',
  MARKET_POSTONLY_MODE: 'market-status',
  ORDER_ID_NOT_FOUND: 'order-not-found',
  CLIENT_ID_NOT_FOUND: 'order-not-found',
  ARENA_ENTRY_NOT_ACTIVE: 'order-not-found',
  GTT_ORDER_EXPIRED: 'order-not-found',
  INDIVISIBLE_PRICE_TICKS: 'invalid-order',
  INDIVISIBLE_QTY_LOTS: 'invalid-order',
  OVER_MAX_PRICE: 'invalid-order',
  PRICE_ABOVE_CAP: 'invalid-order',
  MODIFY_INCREASE_NOT_ALLOWED: 'invalid-order',
  CBOOK_FULL: 'invalid-order',
  ARENA_FULL: 'invalid-order',
  ARITH_OVERFLOW: 'invalid-order',
  POSITION_LIMIT: 'position-limit',
  MARGIN_ACCOUNT_MISSING: 'margin-account',
  MARGIN_LINK_MISMATCH: 'margin-account',
  MARGIN_LINK_LIMIT: 'margin-account',
  MARGIN_ALREADY_LINKED: 'margin-account',
  MARGIN_VAULT_MISMATCH: 'margin-account',
  MARGIN_SEAT_NOT_FLAT: 'margin-account',
  MARGIN_ACCOUNT_INVALID: 'margin-account',
  MARGIN_UNAUTHORIZED: 'unauthorized',
  FUNDING_DISABLED: 'funding',
  INVALID_FUNDING_PARAMS: 'funding',
  FUNDING_UPDATE_NOT_ALONE: 'funding',
  NOT_LIQUIDATABLE: 'liquidation',
  SELF_LIQUIDATION: 'liquidation',
  UNAUTHORIZED_SEAT_AUTH: 'unauthorized',
  UNAUTHORIZED_MARKET_AUTH: 'unauthorized',
  UNAUTHORIZED_WALLET_OWNER: 'unauthorized',
  EXCHANGE_ADMIN_NOT_SIGNER: 'unauthorized',
  EXCHANGE_ADMIN_MISMATCH: 'unauthorized',
  SEAT_NOT_FOUND: 'seat',
  SEAT_ARENA_FULL: 'seat',
  SEAT_ARENA_DATA_NOT_FOUND: 'seat',
  FEE_SEAT: 'seat',
};

/** The errors.h name of a program error code (signed), or null. */
export function perpErrorName(code: bigint | number): PerpErrorName | null {
  const value = typeof code === 'bigint' ? Number(code) : code;
  return NAME_BY_CODE.get(value) ?? null;
}

/** A sentence for a program error code, or undefined for codes a user cannot hit. */
export function perpErrorText(code: bigint | number): string | undefined {
  const name = perpErrorName(code);
  return name ? TEXT[name] : undefined;
}

/** The TransactionVmError name without its prefix (SU_EXHAUSTED), or null. */
export function perpVmErrorName(vmError: number): string | null {
  const name = (TransactionVmError as unknown as Record<number, string>)[vmError];
  return typeof name === 'string' ? name.replace(/^TRANSACTION_VM_ERROR_/, '') : null;
}

/** A u64 user error code as the signed value errors.h defines. */
export function signedUserErrorCode(code: bigint): bigint {
  return code > (1n << 63n) - 1n ? code - (1n << 64n) : code;
}

export function perpErrorKind(vmError: number, userErrorCode: bigint): PerpErrorKind {
  if (vmError === TransactionVmError.TRANSACTION_VM_ERROR_SU_EXHAUSTED) return 'state-units';
  if (vmError === TransactionVmError.TRANSACTION_VM_ERROR_NONCE_TOO_LOW || vmError === TransactionVmError.TRANSACTION_VM_ERROR_NONCE_TOO_HIGH) return 'nonce';
  const name = perpErrorName(userErrorCode);
  if (name) return KIND[name] ?? 'invalid-transaction';
  return 'unknown';
}

/** JSON form of a failed transaction, for logs and agents. */
export interface PerpTransactionErrorInfo {
  name: 'TransactionFailedError' | 'TransactionTimeoutError';
  message: string;
  label: string;
  signature: string;
  kind: PerpErrorKind;
  /** errors.h name, e.g. ORACLE_STALE. */
  code: PerpErrorName | null;
  userErrorCode: string | null;
  vmError: number | null;
  /** TransactionVmError name, e.g. SU_EXHAUSTED. */
  vmErrorName: string | null;
  /** Sending the same intent again (rebuilt and re-signed) may succeed. */
  retryable: boolean;
}

const RETRYABLE: ReadonlySet<PerpErrorKind> = new Set(['oracle', 'state-units', 'nonce', 'timeout', 'market-status']);

export class TransactionFailedError extends Error {
  readonly code: PerpErrorName | null;
  readonly kind: PerpErrorKind;
  readonly vmErrorName: string | null;

  constructor(
    readonly label: string,
    readonly signature: string,
    readonly vmError: number,
    readonly userErrorCode: bigint,
  ) {
    const code = perpErrorName(userErrorCode);
    const vmErrorName = perpVmErrorName(vmError);
    const kind = perpErrorKind(vmError, userErrorCode);
    const detail =
      perpErrorText(userErrorCode) ??
      (kind === 'state-units'
        ? 'the transaction requested too few state units for the account growth it caused (SU_EXHAUSTED); nothing took effect'
        : kind === 'nonce'
          ? `the fee payer nonce was rejected (${vmErrorName}); nothing took effect`
          : code
            ? `${code} (${userErrorCode})`
            : `vmError=${vmError}${vmErrorName ? ` ${vmErrorName}` : ''}, errorCode=${userErrorCode}`);
    super(`${label} failed on-chain: ${detail}`);
    this.name = 'TransactionFailedError';
    this.code = code;
    this.kind = kind;
    this.vmErrorName = vmErrorName;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }

  toJSON(): PerpTransactionErrorInfo {
    return {
      name: 'TransactionFailedError',
      message: this.message,
      label: this.label,
      signature: this.signature,
      kind: this.kind,
      code: this.code,
      userErrorCode: this.userErrorCode.toString(),
      vmError: this.vmError,
      vmErrorName: this.vmErrorName,
      retryable: this.retryable,
    };
  }
}

export class TransactionTimeoutError extends Error {
  readonly kind: PerpErrorKind = 'timeout';

  constructor(readonly label: string, readonly signature: string) {
    super(`${label}: timed out waiting for transaction status (${signature.slice(0, 10)}…)`);
    this.name = 'TransactionTimeoutError';
  }

  toJSON(): PerpTransactionErrorInfo {
    return {
      name: 'TransactionTimeoutError',
      message: this.message,
      label: this.label,
      signature: this.signature,
      kind: 'timeout',
      code: null,
      userErrorCode: null,
      vmError: null,
      vmErrorName: null,
      /* It may still execute: look the signature up before sending again. */
      retryable: false,
    };
  }
}

/** The runtime rejected the fee payer's nonce: the transaction did not
    execute (nothing it carries took effect). */
export function isNonceReject(error: unknown): boolean {
  return error instanceof TransactionFailedError && error.kind === 'nonce';
}

/** The transaction requested fewer state units than it grew accounts by and
    was rolled back as a whole: none of its cancels or orders took effect. */
export function isStateUnitsExhausted(error: unknown): boolean {
  return error instanceof TransactionFailedError && error.kind === 'state-units';
}
