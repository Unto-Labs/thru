import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Pubkey } from "../../../thru-ts-client-sdk/domain/primitives";
import { ABI_MANAGER_PROGRAM_ADDRESS, NOOP_PROGRAM_ADDRESS } from "../../core-program-addresses";
import { deriveOfficialAbiAddress } from "./onchainFetcher";

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
