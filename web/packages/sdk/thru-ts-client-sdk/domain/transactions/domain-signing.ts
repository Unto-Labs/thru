import { Point, etc, hashes, utils } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { sha256 } from "@noble/hashes/sha2.js";

hashes.sha512 = sha512;

/**
 * Standardized Thru Ed25519 signing: RFC-8032 Ed25519 over a domain-separated
 * message M = DST_domain ‖ context, DST being a fixed 16-byte ASCII tag. This
 * is byte-identical to any stock Ed25519 signer over M (HSM/MPC/SDK), which is
 * exactly what a bring-your-own-signer custody partner (e.g. one using a TSM)
 * needs. See specs/mpc-hsm-signer-design.md §4.1.
 */
/**
 * Signing domain -- byte-for-byte in step with `tn_signature_domain_t` in
 * `src/thru/util/tn_signature.h` (values must not be reordered).
 */
export enum SignatureDomain {
    TXN = 0,
    BLOCK_HEADER = 1,
    BLOCK = 2,
    GOSSIP = 3,
    NODE_RECORD = 4,
    EOA_CREATE = 5,
    EOA_DELETE = 6,
    /** Generic user / wallet message signing (see {@link signMessage}). */
    MSG = 7,
}

const SIGNATURE_SIZE = 64;
const PUBKEY_SIZE = 32;
const DST_SIZE = 16;

/**
 * Fixed 16-byte ASCII domain-separation tags. Where the version suffix is
 * shorter than the tag width, the tag is padded with trailing '_' rather
 * than zero-digits (e.g. "v1__" instead of "v001"). TypeScript mirror of the
 * C `tn_signature_dst_table[]` in `src/thru/util/tn_signature.c` -- keep in
 * step across all four language bindings.
 */
const DOMAIN_DST: Record<SignatureDomain, Uint8Array> = {
    [SignatureDomain.TXN]:          new TextEncoder().encode("tn_txn_sign_v1__"),
    [SignatureDomain.BLOCK_HEADER]: new TextEncoder().encode("tn_blkhdr_sig_v1"),
    [SignatureDomain.BLOCK]:        new TextEncoder().encode("tn_block_sig_v1_"),
    [SignatureDomain.GOSSIP]:       new TextEncoder().encode("tn_gossip_sig_v1"),
    [SignatureDomain.NODE_RECORD]:  new TextEncoder().encode("tn_node_rec_v1__"),
    [SignatureDomain.EOA_CREATE]:   new TextEncoder().encode("tn_eoa_create_v1"),
    [SignatureDomain.EOA_DELETE]:   new TextEncoder().encode("tn_eoa_delete_v1"),
    [SignatureDomain.MSG]:          new TextEncoder().encode("tn_msg_sign_v1__"),
};

/**
 * Fresh copy of the 16-byte ASCII DST for `domain`.  Callers building `M`
 * outside of {@link signWithDomain} (e.g. the EOA authorization builders)
 * should source the tag through this accessor rather than duplicating string
 * literals.
 */
export function signatureDomainDST(domain: SignatureDomain): Uint8Array {
    const dst = DOMAIN_DST[domain];
    if (dst === undefined) {
        throw new Error(`Invalid signature domain: ${domain}`);
    }
    return copyBytes(dst);
}

/** p = 2^255 - 19, little-endian. */
const P_LE = Uint8Array.from([
    0xed, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f,
]);

function copyBytes(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes.length);
    out.set(bytes);
    return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
    return etc.concatBytes(...arrays);
}

function sha512Bytes(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(sha512(bytes));
}

function bytesToNumberLE(bytes: Uint8Array): bigint {
    let value = 0n;
    for (let i = 0; i < bytes.length; i++) {
        value += BigInt(bytes[i]) << (8n * BigInt(i));
    }
    return value;
}

function modOrder(value: bigint): bigint {
    const modulus = Point.CURVE().n;
    const result = value % modulus;
    return result >= 0n ? result : result + modulus;
}

// noble's safe `multiply` rejects a 0 scalar; C/Rust/Go treat [0]·P as the
// identity and evaluate the (cofactorless) equation, so substitute Point.ZERO
// for a 0 scalar to keep the accept/reject set byte-identical across languages.
function mulBase(scalar: bigint): Point {
    return scalar === 0n ? Point.ZERO : Point.BASE.multiply(scalar);
}
function mulPoint(p: Point, scalar: bigint): Point {
    return scalar === 0n ? Point.ZERO : p.multiply(scalar);
}

function numberToBytesLE(value: bigint, length: number): Uint8Array {
    const out = new Uint8Array(length);
    let current = value;
    for (let i = 0; i < length; i++) {
        out[i] = Number(current & 0xffn);
        current >>= 8n;
    }
    return out;
}

/** A 32-byte little-endian point encoding is canonical iff y (sign bit masked) < p. */
function encIsCanonical(enc: Uint8Array): boolean {
    if (enc.length !== PUBKEY_SIZE) return false;
    const y = copyBytes(enc);
    y[31] &= 0x7f;
    for (let i = 31; i >= 0; i--) {
        if (y[i] !== P_LE[i]) return y[i] < P_LE[i];
    }
    return false; // y == p is non-canonical
}

/** M = DST_domain ‖ context. TXN context is SHA-256(message); else message. */
export function buildSignedMessage(message: Uint8Array, domain: SignatureDomain): Uint8Array {
    const dst = DOMAIN_DST[domain];
    if (dst === undefined || dst.length !== DST_SIZE) {
        throw new Error(`Invalid signature domain: ${domain}`);
    }
    if (domain === SignatureDomain.TXN) {
        return concatBytes(dst, new Uint8Array(sha256(message)));
    }
    return concatBytes(dst, copyBytes(message));
}

/**
 * Sign M = DST_domain ‖ context with standard RFC-8032 Ed25519.
 */
export async function signWithDomain(
    message: Uint8Array,
    privateKey: Uint8Array,
    publicKey?: Uint8Array,
    domain: SignatureDomain = SignatureDomain.TXN,
): Promise<Uint8Array> {
    if (privateKey.length !== PUBKEY_SIZE) {
        throw new Error("Private key must contain 32 bytes");
    }

    const m = buildSignedMessage(message, domain);
    const extended = utils.getExtendedPublicKey(privateKey);
    // Sign with the public key derived from the seed. If a public key is
    // supplied it must match the derived one (byte-identical across langs;
    // a mismatched keypair is a hard error, not an unverifiable signature).
    const publicKeyBytes = extended.pointBytes;
    if (publicKey !== undefined) {
        if (publicKey.length !== PUBKEY_SIZE) {
            throw new Error("Public key must contain 32 bytes");
        }
        let eq = true;
        for (let i = 0; i < PUBKEY_SIZE; i++) {
            if (publicKey[i] !== publicKeyBytes[i]) {
                eq = false;
                break;
            }
        }
        if (!eq) {
            throw new Error("Public key does not match private key");
        }
    }

    const rInput = concatBytes(extended.prefix, m);
    const r = modOrder(bytesToNumberLE(sha512Bytes(rInput)));
    const R = mulBase(r).toBytes();

    const kInput = concatBytes(R, publicKeyBytes, m);
    const k = modOrder(bytesToNumberLE(sha512Bytes(kInput)));

    const s = modOrder(r + k * extended.scalar);
    const signature = new Uint8Array(SIGNATURE_SIZE);
    signature.set(R, 0);
    signature.set(numberToBytesLE(s, PUBKEY_SIZE), PUBKEY_SIZE);
    return signature;
}

/**
 * Strict/canonical verification: reject non-canonical A/R encodings, small-order
 * A/R, and non-canonical S, then the cofactorless equation [S]B == R + [k]A over
 * M = DST_domain ‖ context. Matches the C/Rust/Go strict policy.
 */
export async function verifyWithDomain(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
    domain: SignatureDomain = SignatureDomain.TXN,
): Promise<boolean> {
    if (signature.length !== SIGNATURE_SIZE || publicKey.length !== PUBKEY_SIZE) {
        return false;
    }
    const rBytes = signature.subarray(0, PUBKEY_SIZE);
    if (!encIsCanonical(publicKey) || !encIsCanonical(rBytes)) {
        return false;
    }
    const s = bytesToNumberLE(signature.subarray(PUBKEY_SIZE));
    if (s >= Point.CURVE().n) {
        return false; // canonical S
    }

    let R: Point;
    let A: Point;
    try {
        R = Point.fromBytes(rBytes);
        A = Point.fromBytes(publicKey);
    } catch {
        return false;
    }
    // reject small-order A / R (order divides 8)
    if (R.clearCofactor().is0() || A.clearCofactor().is0()) {
        return false;
    }

    const m = buildSignedMessage(message, domain);
    const kInput = concatBytes(rBytes, publicKey, m);
    const k = modOrder(bytesToNumberLE(sha512Bytes(kInput)));

    // cofactorless: [S]B == R + [k]A. Zero scalars (S=0 / k=0) are evaluated via
    // Point.ZERO (not thrown/rejected), matching C/Rust/Go exactly.
    const lhs = mulBase(s);
    const rhs = R.add(mulPoint(A, k));
    return lhs.add(rhs.negate()).is0();
}

/**
 * Low-level verify-before-attach primitive: verifies `signature` over
 * `M = buildSignedMessage(message, domain)` for `publicKey` under the
 * strict/canonical policy, then returns a fresh copy of the signature bytes.
 *
 * This primitive trusts the caller to pass the correct `publicKey` and `domain`;
 * for transactions prefer {@link buildTransactionSigningMessage} +
 * {@link attachTransactionSignature}, which derive the expected fee-payer from
 * the body and fix the domain so those cannot be mismatched.
 */
export async function attachSignature(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
    domain: SignatureDomain = SignatureDomain.TXN,
): Promise<Uint8Array> {
    // Snapshot every caller-owned input synchronously up front to eliminate any
    // TOCTOU window: a caller that mutates `signature`/`message`/`publicKey` after
    // the call but before the async verify resolves cannot change what was
    // verified or what is returned.
    const sigSnapshot = copyBytes(signature);
    const msgSnapshot = copyBytes(message);
    const keySnapshot = copyBytes(publicKey);
    if (!(await verifyWithDomain(sigSnapshot, msgSnapshot, keySnapshot, domain))) {
        throw new Error("attachSignature: signature does not verify for the expected key");
    }
    return sigSnapshot;
}

/** Byte offset of the fee-payer public key within a transaction body header. */
const TXN_FEE_PAYER_OFFSET = 48;
/** Length of the fixed transaction wire header — the minimum body length. */
const TXN_HEADER_SIZE = 112;

/**
 * An opaque, frozen transaction signing message. Its state lives in genuinely
 * private (`#`) fields set once at construction from a *copied* body, so it
 * cannot be structurally forged and its bytes cannot be mutated by a caller.
 * The fee-payer key is derived from the body (never independent caller input),
 * and {@link TransactionSigningMessage.attach} re-verifies against that private
 * body — so neither a hand-rolled message nor a post-build mutation can steer the
 * accepted key or desync the signature.
 */
export class TransactionSigningMessage {
    readonly #m: Uint8Array;
    readonly #expectedPublicKey: Uint8Array;
    readonly #body: Uint8Array;

    private constructor(body: Uint8Array) {
        if (body.length < TXN_HEADER_SIZE) {
            throw new Error(
                `TransactionSigningMessage: body ${body.length} bytes is shorter than the ${TXN_HEADER_SIZE}-byte header`,
            );
        }
        // Copy the body so later mutation of the caller's buffer cannot affect us.
        this.#body = copyBytes(body);
        this.#expectedPublicKey = this.#body.slice(
            TXN_FEE_PAYER_OFFSET,
            TXN_FEE_PAYER_OFFSET + PUBKEY_SIZE,
        );
        this.#m = buildSignedMessage(this.#body, SignatureDomain.TXN);
    }

    /**
     * Build from a transaction body (wire bytes before the trailing signature).
     * The expected key is the fee-payer taken from the body header (offset 48),
     * *not* an independent argument — so a caller cannot pair a body owned by
     * fee-payer A with a signer for key B and produce a locally-"valid" signature
     * the chain then rejects. Throws if `body` is shorter than the wire header.
     */
    static fromBody(body: Uint8Array): TransactionSigningMessage {
        return new TransactionSigningMessage(body);
    }

    /** The exact 48 bytes `M = DST_TXN ‖ SHA-256(body)` to hand the HSM/MPC. */
    get m(): Uint8Array {
        return copyBytes(this.#m);
    }
    /** The fee-payer public key the signature must verify under (from the body). */
    get expectedPublicKey(): Uint8Array {
        return copyBytes(this.#expectedPublicKey);
    }
    /** Immutable snapshot of the transaction body. */
    get body(): Uint8Array {
        return copyBytes(this.#body);
    }

    /**
     * Verify an externally-produced signature over `M` for the body's fee-payer
     * under the strict/canonical policy, then return the complete signed
     * transaction wire (`body ‖ sig`) as a fresh buffer. The signature is copied
     * up front (no TOCTOU), and verification/assembly use the private body — so a
     * wrong-key or garbage signature fails locally, not on chain.
     */
    async attach(signature: Uint8Array): Promise<Uint8Array> {
        if (signature.length !== SIGNATURE_SIZE) {
            throw new Error("attach: signature must be 64 bytes");
        }
        const sigSnapshot = copyBytes(signature);
        if (
            !(await verifyWithDomain(
                sigSnapshot,
                this.#body,
                this.#expectedPublicKey,
                SignatureDomain.TXN,
            ))
        ) {
            throw new Error("attach: signature does not verify for the transaction fee-payer");
        }
        const signed = new Uint8Array(this.#body.length + SIGNATURE_SIZE);
        signed.set(this.#body, 0);
        signed.set(sigSnapshot, this.#body.length);
        return signed;
    }
}

/**
 * Bring-your-own-signer surface (e.g. a custody partner via a Builder Vault TSM):
 *
 *   const msg    = buildTransactionSigningMessage(body);   // derives fee-payer
 *   const sig    = await tsm.sign(msg.m);                  // stock Ed25519 over M
 *   const signed = await attachTransactionSignature(msg, sig);  // body ‖ sig
 *
 * Thin free-function wrappers over {@link TransactionSigningMessage} for parity
 * with the Rust `signer` surface.
 */
export function buildTransactionSigningMessage(body: Uint8Array): TransactionSigningMessage {
    return TransactionSigningMessage.fromBody(body);
}
export function attachTransactionSignature(
    message: TransactionSigningMessage,
    signature: Uint8Array,
): Promise<Uint8Array> {
    return message.attach(signature);
}

/**
 * Sign a generic user / wallet message under {@link SignatureDomain.MSG}.
 * Distinct DST from txn / block / node record / EOA authorizations, so a
 * signature produced by a wallet's "sign message" flow can never be replayed
 * as any of them.
 */
export function signMessage(
    message: Uint8Array,
    privateKey: Uint8Array,
    publicKey?: Uint8Array,
): Promise<Uint8Array> {
    return signWithDomain(message, privateKey, publicKey, SignatureDomain.MSG);
}

/** Verify a generic user / wallet message signature produced by {@link signMessage}. */
export function verifyMessage(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
): Promise<boolean> {
    return verifyWithDomain(signature, message, publicKey, SignatureDomain.MSG);
}
