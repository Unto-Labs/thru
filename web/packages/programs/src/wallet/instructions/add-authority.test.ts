import { describe, expect, it } from "vitest";
import {
  decodeAddAuthorityInstruction,
  encodeAddAuthorityInstruction,
  encodeLegacyAddAuthorityInstruction,
} from "./add-authority";
import { encodeRemoveAuthorityInstruction } from "./remove-authority";

const PUBKEY = new Uint8Array(32).fill(7);
const RECORD = {
  authority: { tag: 2 as const, pubkey: PUBKEY },
  expiresAtBlockTimeSeconds: 1_900_000_000n,
};

describe("decodeAddAuthorityInstruction", () => {
  it("round-trips the authority-record layout", () => {
    const data = encodeAddAuthorityInstruction({
      walletAccountIdx: 2,
      authorityRecord: RECORD,
    });

    expect(decodeAddAuthorityInstruction(data)).toEqual({
      walletAccountIdx: 2,
      authority: { tag: 2, pubkey: PUBKEY },
      expiresAtBlockTimeSeconds: 1_900_000_000n,
    });
  });

  it("round-trips the legacy layout without an expiry", () => {
    const data = encodeLegacyAddAuthorityInstruction({
      walletAccountIdx: 0x0102,
      authorityRecord: RECORD,
    });

    expect(decodeAddAuthorityInstruction(data)).toEqual({
      walletAccountIdx: 0x0102,
      authority: { tag: 2, pubkey: PUBKEY },
      expiresAtBlockTimeSeconds: null,
    });
  });

  it("decodes a passkey authority", () => {
    const data = encodeAddAuthorityInstruction({
      walletAccountIdx: 2,
      authorityRecord: {
        authority: {
          tag: 1,
          pubkeyX: new Uint8Array(32).fill(1),
          pubkeyY: new Uint8Array(32).fill(2),
        },
        expiresAtBlockTimeSeconds: 5n,
      },
    });

    expect(decodeAddAuthorityInstruction(data)?.authority).toEqual({
      tag: 1,
      pubkeyX: new Uint8Array(32).fill(1),
      pubkeyY: new Uint8Array(32).fill(2),
    });
  });

  it("returns null for other instructions and malformed data", () => {
    expect(
      decodeAddAuthorityInstruction(
        encodeRemoveAuthorityInstruction({ walletAccountIdx: 2, authIdx: 1 }),
      ),
    ).toBeNull();
    expect(decodeAddAuthorityInstruction(new Uint8Array())).toBeNull();
    expect(
      decodeAddAuthorityInstruction(
        encodeAddAuthorityInstruction({
          walletAccountIdx: 2,
          authorityRecord: RECORD,
        }).subarray(0, 10),
      ),
    ).toBeNull();
  });
});
