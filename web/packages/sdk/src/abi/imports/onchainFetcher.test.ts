import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Pubkey } from "../../../thru-ts-client-sdk/domain/primitives";
import { ABI_MANAGER_PROGRAM_ADDRESS, NOOP_PROGRAM_ADDRESS } from "../../core-program-addresses";
import { deriveOfficialAbiAddress, parseAbiAccountData, parseAbiMetaAccount } from "./onchainFetcher";
import {
  ABI_ACCOUNT_HEADER_SIZE,
  ABI_ACCOUNT_TYPE_CONTENT_V1,
  ABI_ACCOUNT_TYPE_META_V1,
  ABI_STATE_FINALIZED,
} from "./types";

describe("official ABI address defaults", () => {
  it("uses the generated manager address and preserves explicit network overrides", async () => {
    const body = new Uint8Array(96);
    body.set(Pubkey.from(NOOP_PROGRAM_ADDRESS).toBytes());
    const seed = createHash("sha256").update(new Uint8Array([0])).update(body)
      .update("_abi_account").digest();
    const expected = (manager: string) => new Uint8Array(createHash("sha256")
      .update(Pubkey.from(manager).toBytes()).update(new Uint8Array([0])).update(seed).digest());
    expect(await deriveOfficialAbiAddress(NOOP_PROGRAM_ADDRESS))
      .toEqual(expected(ABI_MANAGER_PROGRAM_ADDRESS));

    const oldManager = new Uint8Array(32);
    oldManager.set([0x0a, 0xb1], 30);
    const override = Pubkey.from(oldManager).toThruFmt();
    expect(await deriveOfficialAbiAddress(NOOP_PROGRAM_ADDRESS, override))
      .toEqual(expected(override));
    expect(expected(override)).not.toEqual(expected(ABI_MANAGER_PROGRAM_ADDRESS));
  });
});

describe("ABI Manager account parsing", () => {
  function contentAccount(contents: Uint8Array, accountType = ABI_ACCOUNT_TYPE_CONTENT_V1): Uint8Array {
    const data = new Uint8Array(ABI_ACCOUNT_HEADER_SIZE + contents.length);
    const view = new DataView(data.buffer);
    data[0] = accountType;
    data.fill(7, 1, 33);
    view.setBigUint64(33, 5n, true);
    data[41] = ABI_STATE_FINALIZED;
    view.setUint32(42, contents.length, true);
    data.set(contents, ABI_ACCOUNT_HEADER_SIZE);
    return data;
  }

  it("parses content accounts behind the account type byte", () => {
    const parsed = parseAbiAccountData(contentAccount(new TextEncoder().encode("abi: 1")));
    expect(ABI_ACCOUNT_HEADER_SIZE).toBe(46);
    expect(parsed.abiMetaAccount).toEqual(new Uint8Array(32).fill(7));
    expect(parsed.revision).toBe(5n);
    expect(parsed.state).toBe(ABI_STATE_FINALIZED);
    expect(parsed.content).toBe("abi: 1");
  });

  it("rejects the wrong account type and inconsistent sizes", () => {
    const contents = new TextEncoder().encode("abi");
    expect(() => parseAbiAccountData(contentAccount(contents, ABI_ACCOUNT_TYPE_META_V1)))
      .toThrow(/Not an ABI content account/);
    const padded = new Uint8Array(ABI_ACCOUNT_HEADER_SIZE + contents.length + 1);
    padded.set(contentAccount(contents));
    expect(() => parseAbiAccountData(padded)).toThrow(/size mismatch/);
  });

  it("parses meta accounts and rejects other account types", () => {
    const meta = new Uint8Array(100);
    meta[0] = ABI_ACCOUNT_TYPE_META_V1;
    meta[1] = 1;
    meta[2] = 3;
    meta.fill(9, 4, 100);
    expect(parseAbiMetaAccount(meta)).toEqual({ kind: 1, flags: 3, body: new Uint8Array(96).fill(9) });
    meta[0] = ABI_ACCOUNT_TYPE_CONTENT_V1;
    expect(() => parseAbiMetaAccount(meta)).toThrow(/Not an ABI meta account/);
    meta[0] = ABI_ACCOUNT_TYPE_META_V1;
    expect(() => parseAbiMetaAccount(meta.subarray(0, 99))).toThrow(/Not an ABI meta account/);
  });
});
