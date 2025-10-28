import { createThruClient } from "../client";
import { ConsensusStatus } from "../proto/thru/common/v1/consensus_pb";

const sdk = createThruClient({
    // Configure the SDK to connect to the desired Thru cluster
    // endpoint: "https://api.thru.network", // Example endpoint
});

const counterProgramAddress = 'taXP9YQR-M_1xg_jCh61aVpnMzAy0nqIfMA6waQXUMqfrL'
const derivedAddress = 'taXu7Ka2B1UULjhCfyGb3MMJfHVMoA99Ii_KmgcYHHrsoY'
const seed = 'count1'

const feePayerAddress = 'takJg69_G9ESZ6IyEzYw97h8Xz6H-LdWTD7EF-qomr6Zv2'
const feePayerPrivateKeyHex = '9429cacf4e1faa2524d42aeda5d6daa2eab4ca6b56854ad4da35437911d8176a'

const DEFAULT_COMPUTE_UNITS = 300_000_000;
const DEFAULT_STATE_UNITS = 10_000;
const DEFAULT_MEMORY_UNITS = 10_000;
const DEFAULT_EXPIRY_AFTER = 100;

// Turn an unsigned integer into a little-endian hex string padded to byteLength bytes
export function toLittleEndianHex(value: number | bigint, byteLength: number): string {
    let v = typeof value === "bigint" ? value : BigInt(value);
    const bytes = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// Convenience wrappers matching the screenshot
export const u32ToHexLE = (value: number | bigint) => toLittleEndianHex(value, 4);
export const u16ToHexLE = (value: number | bigint) => toLittleEndianHex(value, 2);


const getIncrementCounterAccountInstructionDataHex = async () => {
    const instructionCreate = u32ToHexLE(1)
    const accountIndex = u16ToHexLE(2)
    const instructionData = instructionCreate + accountIndex
    return instructionData;
}

const accountDataToHex = (data: Uint8Array): string => {
    let dataToHex = Array.from(data, b => b.toString(16).padStart(2, "0")).join("");
    return dataToHex;
}

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

const incrementCounterAccountInstruction = async () => {
    const instructionDataHex = await getIncrementCounterAccountInstructionDataHex();
    const feePayerPublicKey = sdk.helpers.decodeAddress(feePayerAddress);
    const feePayerPrivateKey = hexToBytes(feePayerPrivateKeyHex);

    const transaction = await sdk.transactions.build({
        feePayer: {
            publicKey: feePayerPublicKey,
            privateKey: feePayerPrivateKey,
        },
        program: counterProgramAddress,
        header: {
            fee: 0n,
            computeUnits: DEFAULT_COMPUTE_UNITS,
            stateUnits: DEFAULT_STATE_UNITS,
            memoryUnits: DEFAULT_MEMORY_UNITS,
            expiryAfter: DEFAULT_EXPIRY_AFTER,
        },
        accounts: {
            readWrite: [derivedAddress],
        },
        content: {
            instructions: instructionDataHex,
        },
    })

    await transaction.sign(feePayerPrivateKey);

    const rawTransaction = transaction.toWire();

    const submittedSignature = await sdk.transactions.send(rawTransaction);
    console.log("Submitted transaction signature:", submittedSignature);

    let finalized = false;
    let executionUnits: number | undefined;

    try {
        for await (const update of sdk.transactions.track(submittedSignature, { timeoutMs: 60000 })) {
            const consumed = update.executionResult?.consumedComputeUnits ?? 0;
            const statusKey = ConsensusStatus[update.consensusStatus];
            console.log("Track update:", statusKey, "consumed CU:", consumed);
            if (update.executionResult) {
                executionUnits = consumed;
            }
            if (
                update.consensusStatus === ConsensusStatus.FINALIZED ||
                update.consensusStatus === ConsensusStatus.CLUSTER_EXECUTED
            ) {
                finalized = true;
                break;
            }
        }
    } catch (err) {
        console.warn("Track transaction stream ended with error:", err);
    }

    if (!finalized) {
        console.warn("Transaction not finalized before timeout");
    }
    if (executionUnits !== undefined) {
        console.log("Execution consumed compute units:", executionUnits);
    }
}


async function main() {
    const accountData1 = await sdk.accounts.get(derivedAddress);

    if (accountData1.data) {
        console.log("First Account Data:", accountDataToHex(accountData1.data.data));
    }

    await incrementCounterAccountInstruction();

    await new Promise(resolve => setTimeout(resolve, 2000));

    const accountData2 = await sdk.accounts.get(derivedAddress);

    if (accountData2.data) {
        console.log("Incremented Account Data:", accountDataToHex(accountData2.data.data));
    }
}

console.log("Starting counter script");
main()

// function seedToHex32Padded(seed: string): string {
//     const bytes = new TextEncoder().encode(seed);
//     const padded = new Uint8Array(32);
//     padded.set(bytes.slice(0, 32));
//     return Array.from(padded, b => b.toString(16).padStart(2, "0")).join("");
// }

// const getCreateCounterAccountInstructionDataHex = async () => {
//     const instructionCreate = u32ToHexLE(0)
//     const accountIndex = u16ToHexLE(2)

//     const blockHeight = await sdk.getBlockHeight();
//     const stateProof = await sdk.generateStateProof({
//         proofType: 1,
//         address: derivedAddress,
//         targetSlot: blockHeight.finalized
//     })
//     if (!stateProof.proof || stateProof.proof.proof.length === 0) {
//         console.error("No state proof returned");
//         return;
//     }
//     const stateProofSizeHex = u32ToHexLE(stateProof.proof.proof.length);
//     const seedHex = seedToHex32Padded(seed);

//     const stateProofHex = stateProof.proof.proof.reduce((acc, byte) => acc + byte.toString(16).padStart(2, "0"), "")

//     console.log(instructionCreate, accountIndex, seedHex, stateProofSizeHex, stateProofHex)

//     const instructionData = instructionCreate + accountIndex + seedHex + stateProofSizeHex + stateProofHex
//     return instructionData;
// }

// const createCounterAccountInstruction = async () => {
//     const instructionDataHex = await getCreateCounterAccountInstructionDataHex();
//     console.log("Instruction Data Hex:", instructionDataHex);

//     const feePayerPublicKey = sdk.decodeAddress(feePayerAddress);
//     console.log("Fee Payer Public Key:", feePayerPublicKey);
//     const feePayerPrivateKey = hexToBytes(feePayerPrivateKeyHex);

//     const { rawTransaction, signature } = await sdk.buildAndSignTransaction({
//         feePayer: {
//             publicKey: feePayerPublicKey,
//             privateKey: feePayerPrivateKey,
//         },
//         program: counterProgramAddress,
//         header: {
//             fee: 0n,
//         },
//         accounts: {
//             readWrite: [derivedAddress],
//         },
//         content: {
//             instructions: instructionDataHex,
//         },
//     });

//     console.log("Local signature:", Array.from(signature, b => b.toString(16).padStart(2, "0")).join(""));

//     const submittedSignature = await sdk.sendBuiltTransaction(rawTransaction);
//     console.log("Submitted transaction signature:", submittedSignature);

//     await new Promise(resolve => setTimeout(resolve, 4000));

//     const submittedTransactionStatus = await sdk.getTransactionStatus(submittedSignature);
//     console.log("Submitted transaction status:", submittedTransactionStatus);

//     const submittedTransaction = await sdk.getTransaction(submittedSignature);
//     console.log("Submitted transaction:", submittedTransaction);
// }
