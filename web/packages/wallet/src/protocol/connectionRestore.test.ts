import { describe, expect, it } from "vitest";
import {
  MAX_WALLET_RESTORE_RECORD_BYTES,
  isWalletRestoreRecordShape,
  type WalletRestoreRecord,
} from "./connectionRestore";

const RECORD: WalletRestoreRecord = {
  v: 1,
  chainId: 1,
  appId: "https://wallet.example",
  origin: "https://wallet.example",
  account: {
    index: 0,
    publicKey: "account-a",
    label: "Account 1",
    path: "Account 1",
    createdAt: "2026-09-01T00:00:00.000Z",
    addressType: "thru",
  },
  app: { connectedAt: 1_780_000_000 },
  issuedAt: "2026-09-22T00:00:00.000Z",
};

describe("isWalletRestoreRecordShape", () => {
  it("accepts a well-formed record, with or without the address type", () => {
    expect(isWalletRestoreRecordShape(RECORD)).toBe(true);
    const { addressType: _addressType, ...account } = RECORD.account;
    expect(isWalletRestoreRecordShape({ ...RECORD, account })).toBe(true);
  });

  it.each([
    ["not an object", "record"],
    ["an array", [RECORD]],
    ["null", null],
    ["another version", { ...RECORD, v: 2 }],
    ["a zero chain id", { ...RECORD, chainId: 0 }],
    ["a fractional chain id", { ...RECORD, chainId: 1.5 }],
    ["an empty origin", { ...RECORD, origin: "" }],
    ["a missing account", { ...RECORD, account: undefined }],
    ["a negative index", { ...RECORD, account: { ...RECORD.account, index: -1 } }],
    ["an index past 65535", { ...RECORD, account: { ...RECORD.account, index: 65_536 } }],
    ["a string index", { ...RECORD, account: { ...RECORD.account, index: "0" } }],
    ["an empty address", { ...RECORD, account: { ...RECORD.account, publicKey: "" } }],
    ["a long label", { ...RECORD, account: { ...RECORD.account, label: "x".repeat(65) } }],
    ["a missing createdAt", { ...RECORD, account: { ...RECORD.account, createdAt: undefined } }],
    ["a numeric address type", { ...RECORD, account: { ...RECORD.account, addressType: 1 } }],
    ["a missing app", { ...RECORD, app: undefined }],
    ["a non-finite connectedAt", { ...RECORD, app: { connectedAt: Number.NaN } }],
    ["a missing issuedAt", { ...RECORD, issuedAt: undefined }],
  ])("rejects %s", (_label, value) => {
    expect(isWalletRestoreRecordShape(value)).toBe(false);
  });

  it("rejects a record over the size cap", () => {
    const padded = { ...RECORD, padding: "x".repeat(MAX_WALLET_RESTORE_RECORD_BYTES) };
    expect(isWalletRestoreRecordShape(padded)).toBe(false);
  });

  it("rejects a record that cannot be serialized", () => {
    const cyclic: Record<string, unknown> = { ...RECORD };
    cyclic.self = cyclic;
    expect(isWalletRestoreRecordShape(cyclic)).toBe(false);
  });
});
