import { describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import {
    SIGNATURE_COMMON_CTX_MAX,
    SIGNATURE_CTX_MAX,
    SignatureDomain,
    attachSignature,
    buildSignedMessage,
    signMessage,
    signWithDomain,
    signatureContextMax,
    signatureDomainDST,
    verifyMessage,
    verifyWithDomain,
} from "../domain-signing.js";
import * as legacySigning from "../domain-signing-legacy.js";

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

describe("legacy domain signing", () => {
    const seed = hexToBytes("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
    const pubkey = hexToBytes("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
    const body = new TextEncoder().encode("Thru golden1");
    const legacySigExpected =
        "29fce282f37f766863a1e38bbeb1e174eccde185f1fec157ca47e83bf79452b64902b007a185fcc7213e58cdeb51d587aee8b08f7d862059f3d5455c6f09a204";

    it("matches the pre-cutover transaction signature vector", async () => {
        const signature = await legacySigning.signWithDomain(
            body,
            seed,
            pubkey,
            legacySigning.SignatureDomain.TXN,
        );
        expect(bytesToHex(signature)).toBe(legacySigExpected);
        expect(
            await legacySigning.verifyWithDomain(
                signature,
                body,
                pubkey,
                legacySigning.SignatureDomain.TXN,
            ),
        ).toBe(true);
    });

    it("is not interchangeable with RFC-8032 transaction signing", async () => {
        const legacySignature = await legacySigning.signWithDomain(
            body,
            seed,
            pubkey,
            legacySigning.SignatureDomain.TXN,
        );
        const currentSignature = await signWithDomain(
            body,
            seed,
            pubkey,
            SignatureDomain.TXN,
        );

        expect(
            await verifyWithDomain(
                legacySignature,
                body,
                pubkey,
                SignatureDomain.TXN,
            ),
        ).toBe(false);
        expect(
            await legacySigning.verifyWithDomain(
                currentSignature,
                body,
                pubkey,
                legacySigning.SignatureDomain.TXN,
            ),
        ).toBe(false);
    });
});

describe("per-domain context caps (C tn_signature_sign / tn_signature_verify)", () => {
    const seed = hexToBytes("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
    const pubkey = hexToBytes("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");

    const cases: Array<[SignatureDomain, number]> = [
        [SignatureDomain.MSG, 32768],
        [SignatureDomain.GOSSIP, 32768],
        [SignatureDomain.NODE_RECORD, 32768],
        [SignatureDomain.BLOCK_HEADER, 256],
        [SignatureDomain.BLOCK, 256],
        [SignatureDomain.EOA_CREATE, 256],
        [SignatureDomain.EOA_DELETE, 256],
    ];

    it("matches the C constants", () => {
        expect(SIGNATURE_CTX_MAX).toBe(32768);
        expect(SIGNATURE_COMMON_CTX_MAX).toBe(256);
        expect(signatureContextMax(SignatureDomain.TXN)).toBeUndefined();
    });

    it.each(cases.map(([d, cap]) => [SignatureDomain[d], d, cap] as const))(
        "%s: signs and verifies at the cap, refuses one byte over",
        async (_label, domain, cap) => {
            expect(signatureContextMax(domain)).toBe(cap);

            const at = new Uint8Array(cap).fill(0x42);
            const sig = await signWithDomain(at, seed, pubkey, domain);
            expect(await verifyWithDomain(sig, at, pubkey, domain)).toBe(true);
            expect(buildSignedMessage(at, domain).length).toBe(16 + cap);

            const over = new Uint8Array(cap + 1).fill(0x42);
            expect(() => buildSignedMessage(over, domain)).toThrow(/exceeds the/);
            await expect(signWithDomain(over, seed, pubkey, domain)).rejects.toThrow(
                new RegExp(`exceeds the ${cap}-byte limit`),
            );
            // Checked before the key, as in C/Rust: a bad key length still reports the cap.
            await expect(signWithDomain(over, new Uint8Array(1), undefined, domain)).rejects.toThrow(/exceeds the/);

            // A correct raw Ed25519 signature over DST ‖ over is still refused.
            const m = new Uint8Array(16 + over.length);
            m.set(signatureDomainDST(domain), 0);
            m.set(over, 16);
            const rawSig = await ed.signAsync(m, seed);
            expect(await ed.verifyAsync(rawSig, m, pubkey)).toBe(true);
            expect(await verifyWithDomain(rawSig, over, pubkey, domain)).toBe(false);
            await expect(attachSignature(rawSig, over, pubkey, domain)).rejects.toThrow(/does not verify/);
        },
    );

    it("TXN context is hashed and unbounded", async () => {
        const big = new Uint8Array(SIGNATURE_CTX_MAX + 1).fill(0x42);
        const sig = await signWithDomain(big, seed, pubkey, SignatureDomain.TXN);
        expect(await verifyWithDomain(sig, big, pubkey, SignatureDomain.TXN)).toBe(true);
        expect(buildSignedMessage(big, SignatureDomain.TXN).length).toBe(48);
    });

    it("signMessage / verifyMessage inherit the MSG cap", async () => {
        const at = new Uint8Array(SIGNATURE_CTX_MAX).fill(0x61);
        const sig = await signMessage(at, seed, pubkey);
        expect(await verifyMessage(sig, at, pubkey)).toBe(true);

        const over = new Uint8Array(SIGNATURE_CTX_MAX + 1).fill(0x61);
        await expect(signMessage(over, seed, pubkey)).rejects.toThrow(/exceeds the 32768-byte limit for MSG/);
        expect(await verifyMessage(sig, over, pubkey)).toBe(false);
    });
});
