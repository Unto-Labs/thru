import { createThruClient } from "../client";
import { ConsensusStatus } from "../proto/thru/common/v1/consensus_pb";
import { StateProofType } from "../proto/thru/core/v1/state_pb";
import type { InstructionContext } from "../transactions";

const sdk = createThruClient({
    // Configure the SDK to connect to the desired Thru cluster
    // endpoint: "https://api.thru.network", // Example endpoint
});

const counterProgramAddress = 'taLNrGlb3VsLLXIlT61QtUwVsrI7M5432DxpJRBfY1tOF3'
const seed = 'counter'
const derived = sdk.helpers.deriveProgramAddress({ programAddress: counterProgramAddress, seed: seed })
const derivedAddress = derived.address

const feePayerAddress = 'talmzQqocEh4cR481QpbOjiGoTiFsJLlZqqAQ8TL2PEiGz'
const feePayerPrivateKeyHex = '76d399fc76ed24691594db813c47b5cbd582c14c89b05ff9c4b49df992050259'

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

// Test 1: Using instructionData as a hex string (backward compatible)
const incrementCounterAccountInstructionWithString = async () => {
    const instructionDataHex = await getIncrementCounterAccountInstructionDataHex();
    const feePayerPublicKey = sdk.helpers.decodeAddress(feePayerAddress);
    const feePayerPrivateKey = hexToBytes(feePayerPrivateKeyHex);

    console.log("\n=== Test 1: Using instructionData as hex string ===");
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
        instructionData: instructionDataHex,
    })

    await transaction.sign(feePayerPrivateKey);
    const rawTransaction = transaction.toWire();
    const submittedSignature = await sdk.transactions.send(rawTransaction);
    console.log("Submitted transaction signature:", submittedSignature);
    return submittedSignature;
}

// Test 2: Using instructionData as a function (new capability)
const incrementCounterAccountInstructionWithFunction = async () => {
    const feePayerPublicKey = sdk.helpers.decodeAddress(feePayerAddress);
    const feePayerPrivateKey = hexToBytes(feePayerPrivateKeyHex);
    const derivedAddressBytes = sdk.helpers.decodeAddress(derivedAddress);

    console.log("\n=== Test 2: Using instructionData as a function ===");
    
    // This function dynamically calculates the account index based on the transaction context
    const instructionDataFunction = async (context: InstructionContext): Promise<Uint8Array> => {
        console.log("Function called with context:");
        console.log(`  - Total accounts: ${context.accounts.length}`);
        // Log account addresses as hex for debugging
        context.accounts.forEach((acc, i) => {
            const hex = Array.from(acc).map(b => b.toString(16).padStart(2, "0")).join("");
            console.log(`  - Account [${i}]: ${hex.substring(0, 16)}...`);
        });
        
        // Find the index of the derivedAddress account
        const accountIndex = context.getAccountIndex(derivedAddressBytes);
        console.log(`  - Derived address index (should be 2): ${accountIndex}`);
        
        // Build instruction data: instructionCreate (u32) + accountIndex (u16)
        const instructionCreate = 1; // Increment instruction
        const instructionBytes = new Uint8Array(6); // 4 bytes for u32 + 2 bytes for u16
        
        // Write u32 instructionCreate (little-endian)
        instructionBytes[0] = instructionCreate & 0xff;
        instructionBytes[1] = (instructionCreate >> 8) & 0xff;
        instructionBytes[2] = (instructionCreate >> 16) & 0xff;
        instructionBytes[3] = (instructionCreate >> 24) & 0xff;
        
        // Write u16 accountIndex (little-endian)
        instructionBytes[4] = accountIndex & 0xff;
        instructionBytes[5] = (accountIndex >> 8) & 0xff;
        
        const instructionHex = Array.from(instructionBytes).map(b => b.toString(16).padStart(2, "0")).join("");
        console.log(`  - Generated instruction data: ${instructionHex}`);
        console.log(`  - Expected format: 01000000 (instruction=1) + ${u16ToHexLE(accountIndex)} (accountIndex)`);
        
        return instructionBytes;
    };

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
        instructionData: instructionDataFunction,
    })

    await transaction.sign(feePayerPrivateKey);
    const rawTransaction = transaction.toWire();
    const submittedSignature = await sdk.transactions.send(rawTransaction);
    console.log("Submitted transaction signature:", submittedSignature);
    return submittedSignature;
}

const incrementCounterAccountInstruction = async () => {
    // Run both tests to show both APIs work
    await incrementCounterAccountInstructionWithString();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await incrementCounterAccountInstructionWithFunction();
}


async function main() {
    // Check if counter account exists
    let accountData1;
    let accountExists = false;
    
    try {
        accountData1 = await sdk.accounts.get(derivedAddress);
        accountExists = accountData1.data !== undefined;
    } catch (error: any) {
        // Account doesn't exist - this is expected for new accounts
        if (error?.code === 5 || error?.rawMessage?.includes("not found")) {
            accountExists = false;
            console.log("Counter account does not exist yet");
        } else {
            throw error; // Re-throw unexpected errors
        }
    }

    if (accountExists && accountData1) {
        console.log("Counter account already exists");
        if (accountData1.data?.data) {
            console.log("Account Data:", accountDataToHex(accountData1.data.data));
        }
    } else {
        console.log("Counter account does not exist, creating it...");
        
        // Choose which method to use (function or string)
        // Using function method to demonstrate the new capability
        await createCounterAccountWithFunction();
        
        // Wait for account to be created
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Verify account was created
        try {
            accountData1 = await sdk.accounts.get(derivedAddress);
            if (accountData1.data) {
                console.log("Counter account created successfully!");
                if (accountData1.data?.data) {
                    console.log("Account Data:", accountDataToHex(accountData1.data.data));
                } else {
                    console.error("Failed to get account data");
                    return;
                }
            } else {
                console.error("Failed to create counter account");
                return;
            }
        } catch (error: any) {
            console.error("Failed to verify counter account creation:", error);
            return;
        }
    }

    // Now increment the counter
    console.log("\n=== Incrementing Counter ===");
    await incrementCounterAccountInstruction();

    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        const accountData2 = await sdk.accounts.get(derivedAddress);
        if (accountData2.data?.data) {
            console.log("Incremented Account Data:", accountDataToHex(accountData2.data!.data));
        }
    } catch (error: any) {
        console.warn("Failed to fetch account data after increment:", error);
    }
}

console.log("Starting counter script");
main()

function seedToHex32Padded(seed: string): string {
    const bytes = new TextEncoder().encode(seed);
    const padded = new Uint8Array(32);
    padded.set(bytes.slice(0, 32));
    return Array.from(padded, b => b.toString(16).padStart(2, "0")).join("");
}

// Create counter account instruction data (instruction 0)
const getCreateCounterAccountInstructionData = async (): Promise<Uint8Array> => {
    const instructionCreate = 0; // Create instruction
    const blockHeight = await sdk.blocks.getBlockHeight();
    const stateProof = await sdk.proofs.generate({
        proofType: StateProofType.CREATING,
        address: derivedAddress,
        targetSlot: blockHeight.finalized,
    });
    
    if (!stateProof.proof || stateProof.proof.proof.length === 0) {
        throw new Error("No state proof returned");
    }
    
    const seedBytes = new TextEncoder().encode(seed);
    const seedPadded = new Uint8Array(32);
    seedPadded.set(seedBytes.slice(0, 32));
    
    // Build instruction data:
    // - instructionCreate (u32, 4 bytes)
    // - accountIndex (u16, 2 bytes) - will be set dynamically via function
    // - seed (32 bytes)
    // - stateProofSize (u32, 4 bytes)
    // - stateProof (variable length)
    const stateProofBytes = new Uint8Array(stateProof.proof.proof);
    const instructionData = new Uint8Array(4 + 2 + 32 + 4 + stateProofBytes.length);
    let offset = 0;
    
    // Write instructionCreate (u32, little-endian)
    instructionData[offset++] = instructionCreate & 0xff;
    instructionData[offset++] = (instructionCreate >> 8) & 0xff;
    instructionData[offset++] = (instructionCreate >> 16) & 0xff;
    instructionData[offset++] = (instructionCreate >> 24) & 0xff;
    
    // accountIndex will be written by the function
    offset += 2;
    
    // Write seed (32 bytes)
    instructionData.set(seedPadded, offset);
    offset += 32;
    
    // Write stateProofSize (u32, little-endian)
    const proofSize = stateProofBytes.length;
    instructionData[offset++] = proofSize & 0xff;
    instructionData[offset++] = (proofSize >> 8) & 0xff;
    instructionData[offset++] = (proofSize >> 16) & 0xff;
    instructionData[offset++] = (proofSize >> 24) & 0xff;
    
    // Write stateProof
    instructionData.set(stateProofBytes, offset);
    
    return instructionData;
};

// Create counter account using instructionData as a function
const createCounterAccountWithFunction = async (): Promise<string> => {
    const feePayerPublicKey = sdk.helpers.decodeAddress(feePayerAddress);
    const feePayerPrivateKey = hexToBytes(feePayerPrivateKeyHex);
    const derivedAddressBytes = sdk.helpers.decodeAddress(derivedAddress);

    console.log("\n=== Creating Counter Account (using function) ===");
    
    // Get the base instruction data (without accountIndex)
    const baseInstructionData = await getCreateCounterAccountInstructionData();
    
    // Function that dynamically sets the account index
    const instructionDataFunction = async (context: InstructionContext): Promise<Uint8Array> => {
        console.log("Function called with context:");
        console.log(`  - Total accounts: ${context.accounts.length}`);
        
        // Find the index of the derivedAddress account
        const accountIndex = context.getAccountIndex(derivedAddressBytes);
        console.log(`  - Derived address index: ${accountIndex}`);
        
        // Copy the base instruction data and set the account index
        const instructionData = new Uint8Array(baseInstructionData);
        
        // Write accountIndex at offset 4 (after the 4-byte instructionCreate)
        instructionData[4] = accountIndex & 0xff;
        instructionData[5] = (accountIndex >> 8) & 0xff;
        
        const instructionHex = Array.from(instructionData).map(b => b.toString(16).padStart(2, "0")).join("");
        console.log(`  - Generated instruction data (first 100 chars): ${instructionHex.substring(0, 100)}...`);
        
        return instructionData;
    };

    const { transaction, signature, rawTransaction } = await sdk.transactions.buildAndSign({
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
        instructionData: instructionDataFunction,
    });

    console.log("Local signature:", Array.from(signature, b => b.toString(16).padStart(2, "0")).join(""));

    const submittedSignature = await sdk.transactions.send(rawTransaction);
    console.log("Submitted transaction signature:", submittedSignature);

    // Wait for transaction to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Track the transaction
    let finalized = false;
    try {
        for await (const update of sdk.transactions.track(submittedSignature, { timeoutMs: 60000 })) {
            const consumed = update.executionResult?.consumedComputeUnits ?? 0;
            const statusKey = ConsensusStatus[update.consensusStatus];
            console.log("Track update:", statusKey, "consumed CU:", consumed);
            if (update.executionResult) {
                finalized = true;
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

    const transactionStatus = await sdk.transactions.getStatus(submittedSignature);
    console.log("Submitted transaction status:", transactionStatus);

    return submittedSignature;
};

// Create counter account using instructionData as hex string
const createCounterAccountWithString = async (): Promise<string> => {
    const feePayerPublicKey = sdk.helpers.decodeAddress(feePayerAddress);
    const feePayerPrivateKey = hexToBytes(feePayerPrivateKeyHex);

    console.log("\n=== Creating Counter Account (using hex string) ===");
    
    // Get the base instruction data
    const baseInstructionData = await getCreateCounterAccountInstructionData();
    
    // For hex string version, we need to know the account index ahead of time
    // Account order: [feePayer (0), program (1), derivedAddress (2)]
    const accountIndex = 2;
    
    // Set the account index in the instruction data
    const instructionData = new Uint8Array(baseInstructionData);
    instructionData[4] = accountIndex & 0xff;
    instructionData[5] = (accountIndex >> 8) & 0xff;
    
    // Convert to hex string
    const instructionDataHex = Array.from(instructionData).map(b => b.toString(16).padStart(2, "0")).join("");
    console.log(`Instruction Data Hex (first 100 chars): ${instructionDataHex.substring(0, 100)}...`);

    const { transaction, signature, rawTransaction } = await sdk.transactions.buildAndSign({
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
        instructionData: instructionDataHex,
    });

    console.log("Local signature:", Array.from(signature, b => b.toString(16).padStart(2, "0")).join(""));

    const submittedSignature = await sdk.transactions.send(rawTransaction);
    console.log("Submitted transaction signature:", submittedSignature);

    // Wait and track
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    let finalized = false;
    try {
        for await (const update of sdk.transactions.track(submittedSignature, { timeoutMs: 60000 })) {
            const consumed = update.executionResult?.consumedComputeUnits ?? 0;
            const statusKey = ConsensusStatus[update.consensusStatus];
            console.log("Track update:", statusKey, "consumed CU:", consumed);
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

    return submittedSignature;
};
