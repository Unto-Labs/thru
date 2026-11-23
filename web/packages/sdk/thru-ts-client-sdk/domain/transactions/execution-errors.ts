/* Reading a transaction's execution result.
 *
 * A transaction result carries three numbers:
 *
 *   vmError          The runtime's outcome class code (0 on success).
 *   executionResult  The VM's own halt code, a u64 that reads as a small
 *                    negative number when the VM faulted.
 *   userErrorCode    The u64 a program passed to revert. Only meaningful when
 *                    vmError is VM_REVERT; on any other failure it is whatever
 *                    the register held when the VM stopped.
 *
 * and errorProgramAccIdx, the transaction account index of the program that
 * was running when the VM stopped.
 *
 * The tables here mirror src/thru/runtime/tn_runtime_errors.h and
 * src/thru/runtime/vm/tn_vm_base.h; a test checks them against both headers.
 */

import type { Pubkey } from "../primitives";
import type { Transaction } from "./Transaction";

export type VmErrorClass =
  | "success"
  | "validation"
  | "pre_execution"
  | "execution"
  | "unknown";

export interface VmErrorInfo {
  /** The runtime code, e.g. -765. */
  code: number;
  /** Runtime constant name without its prefix, e.g. "VM_REVERT". */
  name: string;
  /** Short label for a person, e.g. "Reverted". */
  label: string;
  /** When in the transaction's life the failure happened. */
  class: VmErrorClass;
  /** One sentence saying what happened. */
  description: string;
}

type VmErrorEntry = readonly [code: number, name: string, label: string, description: string];

/* TN_RUNTIME_TXN_ERR_* in tn_runtime_errors.h */
const VM_ERROR_ENTRIES: readonly VmErrorEntry[] = [
  [0, "SUCCESS", "Success", "The transaction executed successfully."],

  [-255, "INVALID_FORMAT", "Invalid format", "The transaction bytes could not be parsed."],
  [-254, "INVALID_VERSION", "Invalid version", "The transaction version is not supported."],
  [-253, "INVALID_FLAGS", "Invalid flags", "The transaction sets flags that are not allowed."],
  [-252, "INVALID_SIGNATURE", "Invalid signature", "The fee payer's signature does not verify."],
  [-251, "DUPLICATE_ACCOUNT", "Duplicate account", "The same account is listed more than once."],
  [-250, "UNSORTED_ACCOUNTS", "Unsorted accounts", "The account list is not in the required order."],
  [-249, "UNSORTED_READWRITE_ACCOUNTS", "Unsorted read-write accounts", "The read-write accounts are not sorted."],
  [-248, "UNSORTED_READONLY_ACCOUNTS", "Unsorted read-only accounts", "The read-only accounts are not sorted."],
  [-247, "ACCOUNT_COUNT_LIMIT_EXCEEDED", "Too many accounts", "The transaction lists more accounts than allowed."],
  [-246, "CHAIN_ID_ZERO", "Chain ID is zero", "The transaction does not name a chain."],

  [-511, "NONCE_TOO_LOW", "Nonce too low", "The nonce was already used by an earlier transaction from this fee payer."],
  [-510, "NONCE_TOO_HIGH", "Nonce too high", "The nonce is ahead of the fee payer's next nonce."],
  [-509, "INSUFFICIENT_FEE_PAYER_BALANCE", "Insufficient fee payer balance", "The fee payer cannot afford the fee."],
  [-508, "FEE_PAYER_ACCOUNT_DOES_NOT_EXIST", "Fee payer does not exist", "The fee payer account does not exist."],
  [-507, "NOT_LIVE_YET", "Not live yet", "The transaction's start slot is in the future."],
  [-506, "EXPIRED", "Expired", "The transaction's expiry slot has passed."],
  [-505, "INVALID_FEE_PAYER_STATE_PROOF", "Invalid fee payer state proof", "The fee payer's state proof does not verify."],
  [-504, "INVALID_FEE_PAYER_STATE_PROOF_TYPE", "Invalid fee payer state proof type", "The fee payer's state proof is the wrong kind."],
  [-503, "INVALID_FEE_PAYER_STATE_PROOF_SLOT", "Invalid fee payer state proof slot", "The fee payer's state proof is for a slot that cannot be used."],
  [-502, "INVALID_FEE_PAYER_ACCOUNT_OWNER", "Invalid fee payer owner", "The fee payer is not owned by a program that may pay fees."],
  [-501, "INVALID_FEE_PAYER_STATE_PROOF_ACCOUNT_OWNER", "Invalid fee payer state proof owner", "The account in the fee payer's state proof has the wrong owner."],
  [-500, "INVALID_FEE_PAYER_STATE_PROOF_ACCOUNT_META_DATA_SZ", "Invalid fee payer state proof size", "The account in the fee payer's state proof has the wrong data size."],
  [-499, "CHAIN_ID_MISMATCH", "Chain ID mismatch", "The transaction was signed for a different chain."],
  [-498, "FEE_PAYER_IN_COMPRESSION_TIMEOUT", "Fee payer in compression timeout", "The fee payer was recently compressed and cannot be used yet."],
  [-497, "FEE_PAYER_ACTIVATION_REQUIRES_STATE_UNIT", "Fee payer activation needs a state unit", "Creating the fee payer account needs a state unit the transaction did not request."],
  [-496, "BLOCK_STATE_BUDGET_EXCEEDED", "Block state budget exceeded", "The block has no room left for the state this transaction adds."],
  [-495, "FEE_PAYER_IS_PROGRAM", "Fee payer is a program", "A program account cannot pay fees."],

  [-767, "VM_FAILED", "VM fault", "The program stopped on a fault. Nothing it did was saved."],
  [-766, "INVALID_PROGRAM_ACCOUNT", "Invalid program account", "The account the transaction calls is not a valid program."],
  [-765, "VM_REVERT", "Reverted", "A program stopped the transaction on purpose. Nothing it did was saved."],
  [-764, "CU_EXHAUSTED", "Out of compute units", "The program used more compute units than the transaction requested."],
  [-763, "SU_EXHAUSTED", "Out of state units", "The transaction added more state than the state units it requested."],
];

const VM_ERRORS = new Map<number, VmErrorEntry>(VM_ERROR_ENTRIES.map((entry) => [entry[0], entry]));

/** Runtime code for a program revert (TN_RUNTIME_TXN_ERR_VM_REVERT). */
export const VM_ERROR_REVERT = -765;

function vmErrorClass(code: number): VmErrorClass {
  if (code === 0) return "success";
  /* The class is the code with its low byte cleared (TN_RUNTIME_ERR_CLASS__*). */
  switch ((code >>> 8) & 0xffffff) {
    case 0xffffff:
      return "validation";
    case 0xfffffe:
      return "pre_execution";
    case 0xfffffd:
      return "execution";
    default:
      return "unknown";
  }
}

/** Name, label and explanation for a transaction's `vmError`. */
export function describeVmError(vmError: number): VmErrorInfo {
  const entry = VM_ERRORS.get(vmError);
  const errorClass = vmErrorClass(vmError);
  if (!entry) {
    return {
      code: vmError,
      name: "UNKNOWN",
      label: `Unknown error (${vmError})`,
      class: errorClass,
      description: "This SDK does not know this runtime error code.",
    };
  }
  const [code, name, label, description] = entry;
  return { code, name, label, class: errorClass, description };
}

/** Every known runtime error, for tables and tests. */
export function listVmErrors(): VmErrorInfo[] {
  return VM_ERROR_ENTRIES.map(([code]) => describeVmError(code));
}

type VmHaltEntry = readonly [code: number, name: string, description: string];

/* TN_VM_ERR_SIG* in tn_vm_base.h: the VM stopped the program */
const VM_FAULT_ENTRIES: readonly VmHaltEntry[] = [
  [-1, "SIGTEXT", "The program jumped outside its code."],
  [-2, "SIGILL", "The program ran an instruction the VM does not support."],
  [-3, "SIGSEGV", "The program read or wrote memory it may not access."],
  [-4, "SIGFAULT", "The program was stopped by a failed system call or a revert."],
  [-5, "SIGCU", "The program ran out of compute units."],
  [-6, "SIGSU", "The transaction ran out of state units."],
];

/* TN_VM_ERR_SYSCALL_* in tn_vm_base.h: a system call refused */
const SYSCALL_ERROR_ENTRIES: readonly VmHaltEntry[] = [
  [-7, "BAD_SEGMENT_TABLE_SIZE", "The memory segment table is the wrong size."],
  [-8, "INVALID_ACCOUNT_INDEX", "The account index is not in the transaction."],
  [-9, "ACCOUNT_DOES_NOT_EXIST", "The account does not exist."],
  [-10, "ACCOUNT_NOT_WRITABLE", "The account is not writable in this transaction."],
  [-11, "BALANCE_OVERFLOW", "The balance would overflow."],
  [-12, "ACCOUNT_TOO_BIG", "The account data would exceed the size limit."],
  [-13, "INVALID_OBJ_REF_KIND", "The object reference kind is not valid."],
  [-14, "OBJ_NOT_WRITABLE", "The object is not writable."],
  [-15, "ACCOUNT_ALREADY_EXISTS", "The account already exists."],
  [-16, "BAD_ACCOUNT_ADDRESS", "The account address does not match the one the program derived."],
  [-17, "ACCOUNT_IS_NOT_PROGRAM", "The account is not a program."],
  [-18, "ACCOUNT_HAS_DATA", "The account already has data."],
  [-19, "SEGMENT_ALREADY_MAPPED", "The memory segment is already mapped."],
  [-20, "BAD_PARAMS", "The system call was given invalid arguments."],
  [-21, "INVALID_SEGMENT_ID", "The memory segment id is not valid."],
  [-22, "INVALID_ADDRESS", "The memory address is not valid."],
  [-23, "INVALID_STATE_PROOF", "The state proof does not verify."],
  [-24, "CALL_DEPTH_TOO_DEEP", "Programs called each other too deeply."],
  [-25, "REVERT", "The program reverted."],
  [-26, "INSUFFICIENT_PAGES", "The transaction did not request enough memory units."],
  [-27, "INVALID_ACCOUNT", "The account is not valid for this operation."],
  [-28, "INVALID_SEGMENT_SIZE", "The memory segment size is not valid."],
  [-29, "UNFREEABLE_PAGE", "The memory page cannot be freed."],
  [-30, "LOG_DATA_TOO_LARGE", "The log message is too large."],
  [-31, "EVENT_TOO_LARGE", "The event is too large."],
  [-32, "INVALID_PROOF_LEN", "The state proof has the wrong length."],
  [-33, "INVALID_PROOF_SLOT", "The state proof is for a slot that cannot be used."],
  [-34, "ACCOUNT_IN_COMPRESSION_TIMEOUT", "The account was recently compressed and cannot be used yet."],
  [-35, "INVALID_ACCOUNT_DATA_SIZE", "The account data size is not valid."],
  [-36, "INVALID_SEED_LENGTH", "The address seed has the wrong length."],
  [-37, "TXN_HAS_COMPRESSED_ACCOUNT", "The transaction touches a compressed account."],
  [-38, "INSUFFICIENT_BALANCE", "The account balance is too low."],
  [-39, "INVALID_OFFSET", "The offset is outside the data."],
  [-40, "COMPUTE_UNITS_EXCEEDED", "The system call needs more compute units than remain."],
  [-41, "INVALID_FLAGS", "The system call was given invalid flags."],
  [-42, "EPHEMERAL_ACCOUNT_CANNOT_CREATE_PERSISTENT", "An ephemeral account cannot create a persistent account."],
  [-43, "ACCOUNT_COMPRESSION_NOT_ALLOWED", "This account may not be compressed."],
  [-44, "INVALID_SIGNATURE", "The signature does not verify."],
  [-45, "ACCOUNT_UNCOMPRESSABLE", "This account cannot be compressed."],
  [-46, "EVENT_IS_ZERO_SIZE", "The event has no data."],
  [-47, "NATIVE_RECEIVE_DISABLED", "The account does not accept native token transfers."],
  [-49, "PROGRAM_IN_CALL_STACK", "A program tried to call a program that is already running."],
];

const VM_FAULTS = new Map<number, VmHaltEntry>(VM_FAULT_ENTRIES.map((entry) => [entry[0], entry]));
const SYSCALL_ERRORS = new Map<number, VmHaltEntry>(
  SYSCALL_ERROR_ENTRIES.map((entry) => [entry[0], entry]),
);

/** Read a u64 as the signed 64-bit number with the same bits. */
export function toSignedI64(value: bigint | number): bigint {
  return BigInt.asIntN(64, BigInt(value));
}

/** Read a signed 64-bit number as the u64 with the same bits. */
export function toUnsignedU64(value: bigint | number): bigint {
  return BigInt.asUintN(64, BigInt(value));
}

export interface SyscallErrorInfo {
  /** Signed code, -7..-49. */
  code: number;
  /** Constant name without its prefix, e.g. "ACCOUNT_DOES_NOT_EXIST". */
  name: string;
  description: string;
}

function smallSigned(value: bigint | number): number | undefined {
  const signed = toSignedI64(value);
  return signed >= -1024n && signed <= 0n ? Number(signed) : undefined;
}

/**
 * Name a system call error code. Accepts the u64 or the signed reading.
 * Programs often revert with a system call's return value unchanged, so a
 * revert code in this range usually means this.
 */
export function describeSyscallError(code: bigint | number): SyscallErrorInfo | undefined {
  const signed = smallSigned(code);
  const entry = signed === undefined ? undefined : SYSCALL_ERRORS.get(signed);
  if (!entry) return undefined;
  return { code: entry[0], name: entry[1], description: entry[2] };
}

export type ExecutionResultKind = "success" | "fault" | "syscall" | "unknown";

export interface ExecutionResultInfo {
  /** The value read as a signed 64-bit number, e.g. -3n. */
  signed: bigint;
  /** The value as stored, e.g. 18446744073709551613n. */
  unsigned: bigint;
  kind: ExecutionResultKind;
  /** e.g. "SIGSEGV"; absent when the value is not a known halt code. */
  name?: string;
  description?: string;
}

/** Read a transaction's `executionResult`, the VM's halt code. */
export function describeExecutionResult(executionResult: bigint | number): ExecutionResultInfo {
  const unsigned = toUnsignedU64(executionResult);
  const signed = toSignedI64(executionResult);
  if (signed === 0n) {
    return { signed, unsigned, kind: "success", name: "SUCCESS", description: "The program finished." };
  }
  const small = smallSigned(executionResult);
  const fault = small === undefined ? undefined : VM_FAULTS.get(small);
  if (fault) {
    return { signed, unsigned, kind: "fault", name: fault[1], description: fault[2] };
  }
  const syscall = describeSyscallError(executionResult);
  if (syscall) {
    return { signed, unsigned, kind: "syscall", name: syscall.name, description: syscall.description };
  }
  return { signed, unsigned, kind: "unknown" };
}

/** Every VM fault and system call error, for tables and tests. */
export function listVmHaltCodes(): { faults: SyscallErrorInfo[]; syscalls: SyscallErrorInfo[] } {
  const toInfo = ([code, name, description]: VmHaltEntry): SyscallErrorInfo => ({ code, name, description });
  return { faults: VM_FAULT_ENTRIES.map(toInfo), syscalls: SYSCALL_ERROR_ENTRIES.map(toInfo) };
}

/**
 * Whether `userErrorCode` is a code a program chose. It is only that when the
 * transaction reverted; on any other failure it is leftover register contents.
 */
export function hasProgramErrorCode(vmError: number | undefined): boolean {
  return vmError === VM_ERROR_REVERT;
}

/**
 * The account at a transaction account index: fee payer (0), program (1),
 * then the read-write accounts, then the read-only accounts.
 */
export function transactionAccountAt(
  transaction: Pick<Transaction, "feePayer" | "program" | "readWriteAccounts" | "readOnlyAccounts">,
  index: number,
): Pubkey | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined;
  const accounts = [
    transaction.feePayer,
    transaction.program,
    ...(transaction.readWriteAccounts ?? []),
    ...(transaction.readOnlyAccounts ?? []),
  ];
  return accounts[index] ?? undefined;
}

/**
 * The program that was running when a failed transaction stopped. For a
 * program that called another program which then reverted, this is the
 * callee. Undefined when the transaction did not fail inside the VM.
 */
export function failingProgram(
  transaction: Pick<
    Transaction,
    "feePayer" | "program" | "readWriteAccounts" | "readOnlyAccounts" | "executionResult"
  >,
): Pubkey | undefined {
  const result = transaction.executionResult;
  if (!result) return undefined;
  if (describeVmError(result.vmError).class !== "execution") return undefined;
  /* Index 0 is the fee payer, never a program: the VM did not start. */
  if (result.errorProgramAccIdx < 1) return undefined;
  return transactionAccountAt(transaction, result.errorProgramAccIdx);
}
