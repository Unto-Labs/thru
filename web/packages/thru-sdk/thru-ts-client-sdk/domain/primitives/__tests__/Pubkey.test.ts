import { describe, expect, it } from "vitest";

import { generateTestAddress, generateTestPubkey } from "../../../__tests__/helpers/test-utils";
import { Pubkey } from "../Pubkey";

describe("Pubkey", () => {
    it("creates from bytes", () => {
        const bytes = generateTestPubkey();
        const pubkey = Pubkey.from(bytes);
        expect(pubkey.toBytes()).toEqual(bytes);
    });

    it("creates from ta string", () => {
        const address = generateTestAddress();
        const pubkey = Pubkey.from(address);
        expect(pubkey.toThruFmt()).toBe(address);
    });

    it("creates from hex string", () => {
        const bytes = generateTestPubkey();
        const hex = Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        const pubkey = Pubkey.from(hex);
        expect(pubkey.toBytes()).toEqual(bytes);
    });

    it("equals other representations", () => {
        const bytes = generateTestPubkey();
        const ta = generateTestAddress(bytes[0]);
        const fromBytes = Pubkey.from(bytes);
        const fromTa = Pubkey.from(ta);
        expect(fromBytes.equals(fromTa)).toBe(true);
        expect(fromBytes.equals(ta)).toBe(true);
        expect(fromBytes.equals(bytes)).toBe(true);
    });

    it("round trips via proto", () => {
        const bytes = generateTestPubkey();
        const proto = Pubkey.from(bytes).toProtoPubkey();
        const pubkey = Pubkey.fromProtoPubkey(proto);
        expect(pubkey.toBytes()).toEqual(bytes);
    });

    it("round trips via ta proto", () => {
        const bytes = generateTestPubkey();
        const proto = Pubkey.from(bytes).toProtoTaPubkey();
        const pubkey = Pubkey.fromProtoTaPubkey(proto);
        expect(pubkey.toBytes()).toEqual(bytes);
    });

    it("returns defensive copies", () => {
        const bytes = generateTestPubkey();
        const pubkey = Pubkey.from(bytes);
        const copy = pubkey.toBytes();
        copy[0] ^= 0xff;
        expect(pubkey.toBytes()[0]).toBe(bytes[0]);
    });

    it("throws on invalid length", () => {
        expect(() => Pubkey.from(new Uint8Array(10))).toThrow("Must contain 32 bytes");
    });
});

