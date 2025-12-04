import { describe, expect, it } from "vitest";

import { generateTestSignature, generateTestSignatureString } from "../../../__tests__/helpers/test-utils";
import { Signature } from "../Signature";

describe("Signature", () => {
    it("creates from bytes", () => {
        const bytes = generateTestSignature();
        const signature = Signature.from(bytes);
        expect(signature.toBytes()).toEqual(bytes);
    });

    it("creates from ts string", () => {
        const ts = generateTestSignatureString();
        const signature = Signature.from(ts);
        expect(signature.toThruFmt()).toBe(ts);
    });

    it("creates from hex string", () => {
        const bytes = generateTestSignature();
        const hex = Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        const signature = Signature.from(hex);
        expect(signature.toBytes()).toEqual(bytes);
    });

    it("equals other representations", () => {
        const bytes = generateTestSignature();
        const ts = generateTestSignatureString();
        const fromBytes = Signature.from(bytes);
        const fromTs = Signature.from(ts);
        expect(fromBytes.equals(fromTs)).toBe(true);
        expect(fromBytes.equals(ts)).toBe(true);
        expect(fromBytes.equals(bytes)).toBe(true);
    });

    it("round trips via proto", () => {
        const bytes = generateTestSignature();
        const proto = Signature.from(bytes).toProtoSignature();
        expect(Signature.fromProtoSignature(proto).toBytes()).toEqual(bytes);
    });

    it("round trips via ts proto", () => {
        const bytes = generateTestSignature();
        const proto = Signature.from(bytes).toProtoTsSignature();
        expect(Signature.fromProtoTsSignature(proto).toBytes()).toEqual(bytes);
    });

    it("returns defensive copies", () => {
        const bytes = generateTestSignature();
        const signature = Signature.from(bytes);
        const copy = signature.toBytes();
        copy[0] ^= 0xff;
        expect(signature.toBytes()[0]).toBe(bytes[0]);
    });

    it("throws on invalid length", () => {
        expect(() => Signature.from(new Uint8Array(10))).toThrow("Must contain 64 bytes");
    });
});

