import { describe, expect, it } from "vitest";
import {
    SignatureDomain,
    buildSignedMessage,
    signWithDomain,
    verifyWithDomain,
} from "../domain-signing.js";

function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}
function bytesToHex(b: Uint8Array): string {
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

describe("domain-signing (RFC-8032 + DST)", () => {
    // Cross-language golden anchor: must match the C test_tn_signature GOLDEN
    // vector (RFC-8032 test-1 seed, body "Thru golden1"). Mismatch = chain split.
    const seed = hexToBytes("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
    const pubkey = hexToBytes("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
    // Regenerated for DST "tn_txn_sign_v1__" (v001 → v1__ underscore padding).
    const sigExpected =
        "8edfec88b713fce257ffa9da964d89b43d31b8d179aa1a467bbb32e024461c360bb5daf4f10cf774e439d4446b25297567cddb6bcd08ca931f6fb723b8fdfc0a";
    const body = new TextEncoder().encode("Thru golden1");

    it("txn signature matches the C golden vector", async () => {
        const sig = await signWithDomain(body, seed, pubkey, SignatureDomain.TXN);
        expect(bytesToHex(sig)).toBe(sigExpected);
    });

    it("M = DST_TXN ‖ SHA-256(body)", () => {
        const m = buildSignedMessage(body, SignatureDomain.TXN);
        expect(m.length).toBe(48);
        expect(new TextDecoder().decode(m.subarray(0, 16))).toBe("tn_txn_sign_v1__");
    });

    it("round-trips and enforces domain separation", async () => {
        const sig = await signWithDomain(body, seed, pubkey, SignatureDomain.TXN);
        expect(await verifyWithDomain(sig, body, pubkey, SignatureDomain.TXN)).toBe(true);
        expect(await verifyWithDomain(sig, body, pubkey, SignatureDomain.BLOCK)).toBe(false);
        const bad = Uint8Array.from(sig);
        bad[40] ^= 1;
        expect(await verifyWithDomain(bad, body, pubkey, SignatureDomain.TXN)).toBe(false);
    });
});
