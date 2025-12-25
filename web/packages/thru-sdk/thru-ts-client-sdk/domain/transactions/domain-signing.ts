import { CURVE, Point, etc, utils } from "@noble/ed25519";

/**
 * Signature domain types matching the C implementation.
 */
export enum SignatureDomain {
    TXN = 0,          /* Transaction */
    BLOCK_HEADER = 1, /* Block header */
    BLOCK = 2,        /* Block */
    GOSSIP = 3,      /* Gossip */
}

/**
 * Domain tag values matching the C implementation.
 */
const DOMAIN_TAGS: Record<SignatureDomain, bigint> = {
    [SignatureDomain.TXN]: 1n,
    [SignatureDomain.BLOCK_HEADER]: 2n,
    [SignatureDomain.BLOCK]: 3n,
    [SignatureDomain.GOSSIP]: 4n,
};

/**
 * Size of domain block (128 bytes = SHA-512 block size)
 */
const DOMAIN_BLOCK_SIZE = 128;
const SIGNATURE_SIZE = 64;
const PUBKEY_SIZE = 32;

/**
 * Creates a domain block: 8-byte tag (big-endian) + 120 bytes of zeros = 128 bytes
 */
function createDomainBlock(domain: SignatureDomain): Uint8Array {
    const block = new Uint8Array(DOMAIN_BLOCK_SIZE);
    block.fill(0);
    
    const tag = DOMAIN_TAGS[domain];
    if (tag === undefined) {
        throw new Error(`Invalid signature domain: ${domain}`);
    }
    
    // Write tag as big-endian 8-byte value
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    view.setBigUint64(0, tag, false); // false = big-endian
    
    return block;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes.length);
    out.set(bytes);
    return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
    return etc.concatBytes(...arrays);
}

function bytesToNumberLE(bytes: Uint8Array): bigint {
    let value = 0n;
    for (let i = 0; i < bytes.length; i++) {
        value += BigInt(bytes[i]) << (8n * BigInt(i));
    }
    return value;
}

function modOrder(value: bigint): bigint {
    const modulus = CURVE.n;
    const result = value % modulus;
    return result >= 0n ? result : result + modulus;
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

/**
 * Domain-separated Ed25519 signing that matches the Rust/C implementation:
 * r = H(domain || prefix || msg)
 * k = H(domain || R || A || msg)
 * S = (r + k * scalar) mod L
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

    const domainBlock = createDomainBlock(domain);
    const messageBytes = copyBytes(message);
    const extended = await utils.getExtendedPublicKeyAsync(privateKey);
    const publicKeyBytes = publicKey ? copyBytes(publicKey) : extended.pointBytes;
    if (publicKeyBytes.length !== PUBKEY_SIZE) {
        throw new Error("Public key must contain 32 bytes");
    }

    const rInput = concatBytes(domainBlock, extended.prefix, messageBytes);
    const r = modOrder(bytesToNumberLE(await etc.sha512Async(rInput)));
    const R = Point.BASE.multiply(r).toBytes();

    const kInput = concatBytes(domainBlock, R, publicKeyBytes, messageBytes);
    const k = modOrder(bytesToNumberLE(await etc.sha512Async(kInput)));

    const s = modOrder(r + k * extended.scalar);
    const signature = new Uint8Array(SIGNATURE_SIZE);
    signature.set(R, 0);
    signature.set(numberToBytesLE(s, PUBKEY_SIZE), PUBKEY_SIZE);
    return signature;
}

/**
 * Domain-separated Ed25519 verification matching the Rust/C implementation.
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

    const domainBlock = createDomainBlock(domain);
    const messageBytes = copyBytes(message);
    const rBytes = signature.subarray(0, PUBKEY_SIZE);
    const s = bytesToNumberLE(signature.subarray(PUBKEY_SIZE));
    if (s >= CURVE.n) {
        return false;
    }

    let R: Point;
    let A: Point;
    try {
        R = Point.fromHex(rBytes);
        A = Point.fromHex(publicKey);
    } catch {
        return false;
    }

    const kInput = concatBytes(domainBlock, rBytes, publicKey, messageBytes);
    const k = modOrder(bytesToNumberLE(await etc.sha512Async(kInput)));

    const lhs = Point.BASE.multiply(s);
    const rhs = R.add(A.multiply(k));
    return lhs.add(rhs.negate()).clearCofactor().is0();
}
