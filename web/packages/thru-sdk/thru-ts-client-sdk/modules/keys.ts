import { getPublicKeyAsync } from "@noble/ed25519";
import { getWebCrypto, ThruHDWallet } from "@thru/crypto";

export interface GeneratedKeyPair {
    address: string;
    publicKey: Uint8Array;
    privateKey: Uint8Array;
}

/**
 * Generates a new Ed25519 keypair using the same HD wallet pipeline as the Thru wallet.
 */
export async function generateKeyPair(): Promise<GeneratedKeyPair> {
    const seed = generateSeed();
    const account = await ThruHDWallet.getAccount(seed, 0);
    seed.fill(0);

    return {
        address: account.address,
        publicKey: account.publicKey,
        privateKey: account.privateKey,
    };
}

export async function fromPrivateKey(privateKey: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await getPublicKeyAsync(privateKey));
}

function generateSeed(): Uint8Array {
    const cryptoObj = getWebCrypto();
    const bytes = new Uint8Array(64);
    cryptoObj.getRandomValues(bytes);
    return bytes;
}
