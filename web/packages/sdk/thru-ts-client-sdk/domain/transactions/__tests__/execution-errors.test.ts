import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateTestPubkey } from "../../../__tests__/helpers/test-utils";
import { Pubkey } from "../../primitives";
import {
  describeExecutionResult,
  describeSyscallError,
  describeVmError,
  failingProgram,
  hasProgramErrorCode,
  listVmErrors,
  listVmHaltCodes,
  toSignedI64,
  toUnsignedU64,
  transactionAccountAt,
} from "../execution-errors";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../..");
const readHeader = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf8");

describe("runtime error table", () => {
  /* #define TN_RUNTIME_TXN_ERR_X ((int)(0x01 | TN_RUNTIME_ERR_CLASS__TXN_IN_VALIDATE)) */
  const header = readHeader("src/thru/runtime/tn_runtime_errors.h");
  const classes = new Map<string, number>();
  for (const match of header.matchAll(/#define (TN_RUNTIME_ERR_CLASS__\w+)\s+\((0x[0-9A-Fa-f]+)\)/g)) {
    classes.set(match[1], Number(match[2]));
  }
  const fromHeader = new Map<string, number>();
  for (const match of header.matchAll(
    /#define TN_RUNTIME_TXN_ERR_(\w+)\s+\(\(int\)\((0x[0-9A-Fa-f]+) \| (TN_RUNTIME_ERR_CLASS__\w+)\s*\)\)/g,
  )) {
    const classBits = classes.get(match[3]);
    if (classBits === undefined) throw new Error(`unknown class ${match[3]}`);
    fromHeader.set(match[1], (Number(match[2]) | classBits) | 0);
  }

  it("lists every code in tn_runtime_errors.h with the same value", () => {
    expect(fromHeader.size).toBeGreaterThan(30);
    const table = new Map(listVmErrors().map((info) => [info.name, info.code]));
    table.delete("SUCCESS");
    expect(Object.fromEntries(table)).toEqual(Object.fromEntries(fromHeader));
  });

  it("classes a code by when it happened", () => {
    expect(describeVmError(0).class).toBe("success");
    expect(describeVmError(-252).class).toBe("validation");
    expect(describeVmError(-511).class).toBe("pre_execution");
    expect(describeVmError(-765)).toMatchObject({
      name: "VM_REVERT",
      label: "Reverted",
      class: "execution",
    });
  });

  it("keeps an unknown code readable", () => {
    expect(describeVmError(-700)).toMatchObject({ name: "UNKNOWN", label: "Unknown error (-700)" });
  });
});

describe("VM halt code tables", () => {
  /* #define TN_VM_ERR_SYSCALL_X (-9UL), plus one TN_VM_SYSCALL_ERR_X */
  const header = readHeader("src/thru/runtime/vm/tn_vm_base.h");
  const faults = new Map<string, number>();
  const syscalls = new Map<string, number>();
  for (const match of header.matchAll(/#define TN_VM_(ERR_SYSCALL|SYSCALL_ERR|ERR)_(\w+)\s+\((-\d+)UL\)/g)) {
    (match[1] === "ERR" ? faults : syscalls).set(match[2], Number(match[3]));
  }

  it("lists every fault and system call error in tn_vm_base.h", () => {
    expect(faults.size).toBe(6);
    expect(syscalls.size).toBeGreaterThan(40);
    const table = listVmHaltCodes();
    expect(Object.fromEntries(table.faults.map((info) => [info.name, info.code]))).toEqual(
      Object.fromEntries(faults),
    );
    expect(Object.fromEntries(table.syscalls.map((info) => [info.name, info.code]))).toEqual(
      Object.fromEntries(syscalls),
    );
  });
});

describe("describeExecutionResult", () => {
  it("reads a fault from the stored u64", () => {
    expect(describeExecutionResult(18446744073709551613n)).toMatchObject({
      signed: -3n,
      unsigned: 18446744073709551613n,
      kind: "fault",
      name: "SIGSEGV",
    });
  });

  it("reads success and system call errors", () => {
    expect(describeExecutionResult(0n).kind).toBe("success");
    expect(describeExecutionResult(-9n)).toMatchObject({
      kind: "syscall",
      name: "ACCOUNT_DOES_NOT_EXIST",
    });
  });

  it("leaves an unknown value unnamed", () => {
    const info = describeExecutionResult(0x1000090n);
    expect(info.kind).toBe("unknown");
    expect(info.name).toBeUndefined();
    expect(info.signed).toBe(0x1000090n);
  });
});

describe("signed and unsigned readings", () => {
  it("round-trips", () => {
    expect(toSignedI64(18446744073709551515n)).toBe(-101n);
    expect(toUnsignedU64(-101n)).toBe(18446744073709551515n);
    expect(toSignedI64(7n)).toBe(7n);
  });
});

describe("describeSyscallError", () => {
  it("names a passed-through system call code from either reading", () => {
    expect(describeSyscallError(-16n)?.name).toBe("BAD_ACCOUNT_ADDRESS");
    expect(describeSyscallError(toUnsignedU64(-16n))?.name).toBe("BAD_ACCOUNT_ADDRESS");
  });

  it("does not name faults, positive codes or the unused -48", () => {
    expect(describeSyscallError(-3n)).toBeUndefined();
    expect(describeSyscallError(7n)).toBeUndefined();
    expect(describeSyscallError(-48n)).toBeUndefined();
  });
});

describe("failing program", () => {
  const key = (seed: number) => Pubkey.from(generateTestPubkey(seed));
  const base = {
    feePayer: key(1),
    program: key(2),
    readWriteAccounts: [key(3)],
    readOnlyAccounts: [key(4), key(5)],
  };
  const withResult = (vmError: number, errorProgramAccIdx: number) =>
    ({ ...base, executionResult: { vmError, errorProgramAccIdx } }) as unknown as Parameters<
      typeof failingProgram
    >[0];

  it("indexes fee payer, program, read-write, then read-only", () => {
    expect(transactionAccountAt(base, 0)).toBe(base.feePayer);
    expect(transactionAccountAt(base, 1)).toBe(base.program);
    expect(transactionAccountAt(base, 2)).toBe(base.readWriteAccounts[0]);
    expect(transactionAccountAt(base, 4)).toBe(base.readOnlyAccounts[1]);
    expect(transactionAccountAt(base, 5)).toBeUndefined();
    expect(transactionAccountAt(base, -1)).toBeUndefined();
  });

  it("is the callee when a called program reverts", () => {
    expect(failingProgram(withResult(-765, 3))).toBe(base.readOnlyAccounts[0]);
    expect(failingProgram(withResult(-765, 1))).toBe(base.program);
  });

  it("is undefined when the VM never ran or the transaction succeeded", () => {
    expect(failingProgram(withResult(0, 1))).toBeUndefined();
    expect(failingProgram(withResult(-511, 0))).toBeUndefined();
    expect(failingProgram(withResult(-765, 0))).toBeUndefined();
    expect(failingProgram({ ...base, executionResult: undefined })).toBeUndefined();
  });
});

describe("hasProgramErrorCode", () => {
  it("is true only for a revert", () => {
    expect(hasProgramErrorCode(-765)).toBe(true);
    expect(hasProgramErrorCode(-767)).toBe(false);
    expect(hasProgramErrorCode(0)).toBe(false);
    expect(hasProgramErrorCode(undefined)).toBe(false);
  });
});
