import { createThruClient } from "../client";
import { ConsensusStatus } from "../proto/thru/common/v1/consensus_pb";


const sdk = createThruClient({
    // endpoint: "https://api.thru.network", // Set to your cluster endpoint.
});

// Replace with the account you want to create and its 32-byte private key.

const keypair = await sdk.keys.generateKeyPair()
const targetAccountAddress = keypair.address
const targetAccountPrivateKey = keypair.privateKey

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
    const feePayerPrivateKey = targetAccountPrivateKey

    const transaction = await sdk.accounts.create({
        publicKey: feePayerPublicKey,
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
