import { signAsync, verifyAsync } from "@noble/ed25519";

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

/**
 * Prepends domain block to message for domain-separated signing/verification.
 * Simple approach: just prepend the domain block to the message.
 */
function prependDomainBlock(message: Uint8Array, domain: SignatureDomain): Uint8Array {
    const domainBlock = createDomainBlock(domain);
    const result = new Uint8Array(domainBlock.length + message.length);
    result.set(domainBlock, 0);
    result.set(message, domainBlock.length);
    return result;
}

/**
 * Domain-separated Ed25519 signing.
 * Simple approach: prepend domain block to message, then sign normally.
 */
export async function signWithDomain(
    message: Uint8Array,
    privateKey: Uint8Array,
    publicKey: Uint8Array,
    domain: SignatureDomain = SignatureDomain.TXN,
): Promise<Uint8Array> {
    const messageWithDomain = prependDomainBlock(message, domain);
    return signAsync(messageWithDomain, privateKey);
}

/**
 * Domain-separated Ed25519 verification.
 * Simple approach: prepend domain block to message, then verify normally.
 */
export async function verifyWithDomain(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
    domain: SignatureDomain = SignatureDomain.TXN,
): Promise<boolean> {
    const messageWithDomain = prependDomainBlock(message, domain);
    return verifyAsync(signature, messageWithDomain, publicKey);
}
