import { getPublicKeyAsync } from "@noble/ed25519";
import { createThruClient } from "../client";
import { ConsensusStatus } from "../proto/thru/common/v1/consensus_pb";


const sdk = createThruClient({
    // endpoint: "https://api.thru.network", // Set to your cluster endpoint.
});

// Replace with the account you want to create and its 32-byte private key.
const targetAccountPrivateKeyHex = "da0abd760d32d319ad11069d2d56f8c61b03f28d4096947c5117a54f427e4d60";
const targetAccountAddress = sdk.helpers.encodeAddress(await getPublicKeyAsync(targetAccountPrivateKeyHex))

function hexToBytes(hex: string): Uint8Array {
    const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (normalized.length % 2 !== 0) {
        throw new Error("Private key hex must contain an even number of characters");
    }
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < normalized.length; i += 2) {
        bytes[i / 2] = parseInt(normalized.substring(i, i + 2), 16);
    }
    return bytes;
}

async function fetchAccountSnapshot(label: string, address: string): Promise<void> {
    try {
        const account = await sdk.accounts.get(address);
        const consensus = account.consensusStatus != null
            ? ConsensusStatus[account.consensusStatus]
            : "UNKNOWN";
        const slot = account.versionContext?.slot ?? 0n;
        const balance = account.meta?.balance ?? 0n;
        const stateCounter = account.meta?.stateCounter ?? 0n;

        console.log(
            `${label} account status: consensus=${consensus}, slot=${slot.toString()}, balance=${balance.toString()}, stateCounter=${stateCounter.toString()}`,
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`${label} account lookup failed: ${message}`);
    }
}

async function run(): Promise<void> {
    console.log("Preparing create account transaction");

    await fetchAccountSnapshot("Pre-create", targetAccountAddress);

    const feePayerPublicKey = sdk.helpers.decodeAddress(targetAccountAddress);
    const feePayerPrivateKey = hexToBytes(targetAccountPrivateKeyHex);

    const transaction = await sdk.accounts.create({
        publicKey: feePayerPublicKey
    })

    await transaction.sign(feePayerPrivateKey);

    const rawTransaction = transaction.toWire();

    console.log("Submitting transaction");
    const submittedSignature = await sdk.transactions.send(rawTransaction);
    // Allow some time for the cluster to reflect the new account state.
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const transactionStatus = await sdk.transactions.getStatus(submittedSignature);
    console.log("Submitted transaction status:", transactionStatus);
    console.log("Submitted transaction signature:", submittedSignature);

    // await trackTransaction(submittedSignature);

    // Allow some time for the cluster to reflect the new account state.
    await new Promise(resolve => setTimeout(resolve, 2_000));

    await fetchAccountSnapshot("Post-create", targetAccountAddress);
}

run().catch(error => {
    console.error("Create account script failed:", error);
});
