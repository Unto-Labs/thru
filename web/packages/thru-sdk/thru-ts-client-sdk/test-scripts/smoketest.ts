
import { createThruClient } from "../client";
import type { Account } from "../domain/accounts";
import type { Block } from "../domain/blocks";
import type { ChainEvent } from "../domain/events";
import { Filter, FilterParamValue } from "../domain/filters";
import { PageRequest } from "../domain/pagination";
import type { Transaction as TransactionModel } from "../domain/transactions";
import type { TrackTransactionUpdate } from "../modules/streaming";
import { ConsensusStatus } from "../proto/thru/common/v1/consensus_pb";
import { StateProofType } from "../proto/thru/core/v1/state_pb";

interface MaybeNodeProcess {
    env?: Record<string, string | undefined>;
    exitCode?: number;
}

const nodeProcess: MaybeNodeProcess | undefined = (globalThis as { process?: MaybeNodeProcess }).process;

const BASE_URL = nodeProcess?.env?.THRU_BASE_URL;
const FEE_PAYER_ADDRESS = nodeProcess?.env?.THRU_FEE_PAYER_ADDRESS;
const FEE_PAYER_PRIVATE_KEY_HEX = nodeProcess?.env?.THRU_FEE_PAYER_PRIVATE_KEY_HEX;

const sdk = createThruClient({ baseUrl: BASE_URL });

async function runStep<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    console.log(`\n=== ${label} ===`);
    try {
        const result = await fn();
        return result;
    } catch (error) {
        console.error(`${label} failed: ${formatError(error)}`);
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }
        return undefined;
    }
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    if (typeof error === "object") {
        try {
            return JSON.stringify(error);
        } catch (_jsonError) {
            return String(error);
        }
    }
    return String(error);
}

function bytesToHex(bytes: Uint8Array): string {
    let hex = "";
    for (let i = 0; i < bytes.length; i += 1) {
        hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toHex(bytes?: Uint8Array | null, maxBytes = 8): string | undefined {
    if (!bytes || bytes.length === 0) {
        return undefined;
    }
    const hex = bytesToHex(bytes);
    if (bytes.length <= maxBytes) {
        return `0x${hex}`;
    }
    const prefix = hex.slice(0, maxBytes * 2);
    const suffix = hex.slice(-maxBytes * 2);
    return `0x${prefix}…${suffix}`;
}

function consensusStatusLabel(value?: number): string {
    if (value === undefined) {
        return "UNKNOWN";
    }
    const labels = ConsensusStatus as unknown as Record<number, string>;
    return labels[value] ?? `UNKNOWN(${value})`;
}

function hexToBytes(hex: string): Uint8Array {
    const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (normalized.length % 2 !== 0) {
        throw new Error("Hex string must have an even length");
    }
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < normalized.length; i += 2) {
        bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
    }
    return bytes;
}

const encodeAddress = (bytes?: Uint8Array | null): string | undefined => {
    if (!bytes) {
        return undefined;
    }
    try {
        return sdk.helpers.encodeAddress(bytes);
    } catch (_error) {
        return toHex(bytes);
    }
};

const encodeSignature = (bytes?: Uint8Array | null): string | undefined => {
    if (!bytes) {
        return undefined;
    }
    try {
        return sdk.helpers.encodeSignature(bytes);
    } catch (_error) {
        return toHex(bytes, 16);
    }
};

function logBlockSummary(block: Block): void {
    const header = block.header;
    if (!header) {
        console.log(" - Block is missing header information");
        return;
    }
    console.log(` - Slot: ${header.slot}`);
    console.log(` - Block hash: ${toHex(header.blockHash)}`);
    console.log(` - Producer: ${encodeAddress(header.producer)}`);
    console.log(` - Version: ${header.version}`);
    console.log(` - Max compute units: ${header.maxComputeUnits}`);
    console.log(` - Max block size: ${header.maxBlockSize}`);
    console.log(` - Consensus status: ${consensusStatusLabel(block.consensusStatus)}`);
    console.log(` - Transactions in body: ${block.getTransactions().length}`);
}

function logAccountSummary(account: Account): void {
    console.log(` - Address: ${encodeAddress(account.address)}`);
    if (account.meta) {
        console.log(
            `   Meta → version=${account.meta.version} seq=${account.meta.seq} balance=${account.meta.balance} nonce=${account.meta.nonce}`,
        );
        console.log(
            `   Flags → program=${account.meta.flags.isProgram} privileged=${account.meta.flags.isPrivileged} compressed=${account.meta.flags.isCompressed}`,
        );
    }
    if (account.data?.data) {
        console.log(`   Data bytes: ${account.data.data.length}`);
    }
    if (account.versionContext) {
        console.log(
            `   Version context → slot=${account.versionContext.slot} timestampNs=${account.versionContext.blockTimestampNs}`,
        );
    }
    console.log(`   Consensus status: ${consensusStatusLabel(account.consensusStatus)}`);
}

function logTransactionSummary(transaction: TransactionModel): void {
    console.log(` - Signature: ${encodeSignature(transaction.getSignature())}`);
    console.log(`   Fee payer: ${encodeAddress(transaction.feePayer)}`);
    console.log(`   Program: ${encodeAddress(transaction.program)}`);
    console.log(
        `   Header → fee=${transaction.fee} nonce=${transaction.nonce} startSlot=${transaction.startSlot} expiryAfter=${transaction.expiryAfter}`,
    );
    console.log(
        `   Limits → CU=${transaction.requestedComputeUnits} SU=${transaction.requestedStateUnits} MU=${transaction.requestedMemoryUnits}`,
    );
    console.log(
        `   Accounts → readWrite=${transaction.readWriteAccounts.length} readOnly=${transaction.readOnlyAccounts.length}`,
    );
    console.log(`   Instruction data length: ${transaction.instructionData?.length ?? 0}`);
    if (transaction.executionResult) {
        console.log(
            `   Execution → status=${transaction.executionResult.executionResult} CU=${transaction.executionResult.consumedComputeUnits}`,
        );
    }
}

function logEventSummary(event: ChainEvent): void {
    console.log(` - Event ID: ${event.id}`);
    console.log(`   Slot: ${event.slot}`);
    console.log(`   Program: ${encodeAddress(event.program)}`);
    console.log(`   Payload bytes: ${event.payload?.length ?? 0}`);
}

function logTrackUpdate(update: TrackTransactionUpdate): void {
    console.log(
        ` - Update status=${consensusStatusLabel(update.statusCode)} consumedCU=${update.executionResult?.consumedComputeUnits ?? 0} signature=${encodeSignature(update.signature)}`,
    );
}

async function streamWithLimit<T>(
    iterable: AsyncIterable<T>,
    limit: number,
    label: string,
    onItem: (value: T, index: number) => void,
): Promise<void> {
    let count = 0;
    try {
        for await (const item of iterable) {
            onItem(item, count);
            count += 1;
            if (count >= limit) {
                break;
            }
        }
    } catch (error) {
        if ((error as { name?: string }).name !== "AbortError") {
            console.error(`${label} stream error: ${formatError(error)}`);
        }
    }
}

async function main(): Promise<void> {
    console.log("Thru SDK catch-all smoke test");
    console.log(`Base URL: ${sdk.ctx.baseUrl}`);
    if (!BASE_URL) {
        console.log("(set THRU_BASE_URL to override the default endpoint)");
    }

    let sampleAccountAddress: string | undefined;
    let sampleTransactionSignature: string | undefined;

    await runStep("Fetch version information", async () => {
        const response = await sdk.version.get();
        const entries = Object.entries(response.components);
        if (!entries.length) {
            console.log(" - No version entries returned");
        }
        for (const [key, value] of entries) {
            console.log(` - ${key}: ${value}`);
        }
        return response;
    });

    const height = await runStep("Fetch chain heights", async () => {
        const response = await sdk.blocks.getBlockHeight();
        console.log(` - finalized: ${response.finalized}`);
        console.log(` - locally executed: ${response.locallyExecuted}`);
        console.log(` - cluster executed: ${response.clusterExecuted}`);
        return response;
    });

    const demoKeyPair = await runStep("Generate demo key pair", async () => {
        const keyPair = await sdk.keys.generateKeyPair();
        console.log(` - Address: ${keyPair.address}`);
        console.log(` - Public key bytes: ${keyPair.publicKey.length}`);
        console.log(` - Private key bytes: ${keyPair.privateKey.length}`);
        return keyPair;
    });

    if (demoKeyPair) {
        await runStep("Derive public key from private key", async () => {
            const derived = await sdk.keys.fromPrivateKey(demoKeyPair.privateKey);
            console.log(` - Derived matches generated public key: ${bytesEqual(derived, demoKeyPair.publicKey)}`);
            return derived;
        });

        const creationTransaction = await runStep("Build account creation transaction", async () => {
            const transaction = await sdk.accounts.create({ publicKey: demoKeyPair.publicKey });
            logTransactionSummary(transaction);
            return transaction;
        });

        if (creationTransaction) {
            const sendResult = await runStep("Sign and send account creation transaction", async () => {
                const signatureBytes = await creationTransaction.sign(demoKeyPair.privateKey);
                console.log(` - Local signature: ${toHex(signatureBytes, 16)}`);
                const submittedSignature = await sdk.transactions.send(creationTransaction.toWire());
                console.log(` - Submitted signature: ${submittedSignature}`);
                return { submittedSignature };
            });

            const submittedSignature = sendResult?.submittedSignature;

            if (submittedSignature) {
                sampleTransactionSignature = submittedSignature;

                await runStep("Track account creation transaction", async () => {
                    let finalized = false;
                    for await (const update of sdk.transactions.track(submittedSignature, { timeoutMs: 30000 })) {
                        logTrackUpdate(update);
                        if (
                            update.statusCode === ConsensusStatus.FINALIZED ||
                            update.statusCode === ConsensusStatus.CLUSTER_EXECUTED
                        ) {
                            finalized = true;
                            break;
                        }
                    }
                    if (!finalized) {
                        console.log(" - Transaction not finalized before timeout");
                    }
                });

                await sleep(2000);

                const createdAccount = await runStep("Fetch newly created account", async () => {
                    const account = await sdk.accounts.get(demoKeyPair.address);
                    logAccountSummary(account);
                    return account;
                });

                if (createdAccount) {
                    sampleAccountAddress = demoKeyPair.address;
                }
            }
        }
    }

    const finalizedSlot = height?.finalized;

    const latestBlock = finalizedSlot !== undefined
        ? await runStep(`Fetch block at finalized slot ${finalizedSlot}`, async () => {
              const block = await sdk.blocks.get({ slot: finalizedSlot });
              logBlockSummary(block);
              return block;
          })
        : undefined;

    if (finalizedSlot !== undefined) {
        await runStep(`Fetch raw block at slot ${finalizedSlot}`, async () => {
            const raw = await sdk.blocks.getRaw({ slot: finalizedSlot });
            console.log(` - Raw block bytes: ${raw.rawBlock.length}`);
            return raw;
        });
    }

    const recentBlocks = await runStep("List recent blocks", async () => {
        const response = await sdk.blocks.list({ page: new PageRequest({ pageSize: 3 }) });
        response.blocks.forEach((block, index) => {
            console.log(`Block #${index + 1}`);
            logBlockSummary(block);
        });
        return response.blocks;
    });

    const blockCandidates: Block[] = [];
    if (latestBlock) {
        blockCandidates.push(latestBlock);
    }
    if (recentBlocks) {
        blockCandidates.push(...recentBlocks);
    }

    if (!sampleAccountAddress && latestBlock?.header?.producer) {
        sampleAccountAddress = encodeAddress(latestBlock.header.producer);
    }
    

    let sampleSignature: string | undefined = sampleTransactionSignature;
    for (const block of blockCandidates) {
        const transactions = block.getTransactions();
        const txWithSignature = transactions.find((tx) => tx.getSignature());
        if (txWithSignature) {
            sampleSignature = encodeSignature(txWithSignature.getSignature());
            sampleTransactionSignature = sampleSignature ?? sampleTransactionSignature;
            break;
        }
    }

    const accountList = sampleAccountAddress
        ? await runStep("List accounts for owner", async () => {
             const ownerBytes = sdk.helpers.decodeAddress(sampleAccountAddress!);
             const filter = new Filter({
                 expression: "account.meta.owner.value == params.owner_bytes",
                 params: {
                     owner_bytes: FilterParamValue.bytes(ownerBytes),
                 },
             });
              const response = await sdk.accounts.list({
                  filter,
                  page: new PageRequest({ pageSize: 3 }),
              });
              response.accounts.forEach((account, index) => {
                  console.log(`Account #${index + 1}`);
                  logAccountSummary(account);
              });
              return response.accounts;
          })
        : (console.log("\n=== List accounts ==="), console.log("Skipping account list – no known account owner"), undefined);

    if (!sampleAccountAddress && accountList && accountList.length > 0) {
        sampleAccountAddress = encodeAddress(accountList[0].address);
    }

    if (sampleAccountAddress) {
        await runStep(`Fetch account ${sampleAccountAddress}`, async () => {
            const account = await sdk.accounts.get(sampleAccountAddress!);
            logAccountSummary(account);
            return account;
        });

        await runStep(`Fetch raw account ${sampleAccountAddress}`, async () => {
            const raw = await sdk.accounts.getRaw(sampleAccountAddress!);
            console.log(` - Raw account metadata bytes: ${raw.rawMeta.length}`);
            console.log(` - Raw account data bytes: ${raw.rawData?.length ?? 0}`);
            return raw;
        });

        await runStep(`Stream account updates for ${sampleAccountAddress}`, async () => {
            const stream = sdk.accounts.stream(sampleAccountAddress!, { signal: AbortSignal.timeout(5000) });
            await streamWithLimit(stream, 1, "account", ({ update }) => {
                if (update.kind === "snapshot") {
                    console.log(" - Received snapshot update");
                    logAccountSummary(update.snapshot.account);
                } else if (update.kind === "update") {
                    console.log(` - Account update at slot ${update.update.slot}`);
                }
            });
        });
    }

    if (finalizedSlot !== undefined) {
        await runStep("Stream recent blocks", async () => {
            const startSlot = finalizedSlot > 1n ? finalizedSlot - 1n : 0n;
            const stream = sdk.blocks.stream({ startSlot, signal: AbortSignal.timeout(5000) });
            await streamWithLimit(stream, 2, "blocks", ({ block }, index) => {
                console.log(` - Streamed block #${index + 1} slot=${block.header?.slot}`);
            });
        });
    }

    const transactionsForAccount = sampleAccountAddress
        ? await runStep(`List transactions for ${sampleAccountAddress}`, async () => {
              const response = await sdk.transactions.listForAccount(sampleAccountAddress!, {
                  page: new PageRequest({ pageSize: 3 }),
              });
              response.transactions.forEach((transaction, index) => {
                  console.log(`Transaction #${index + 1}`);
                  logTransactionSummary(transaction);
              });
              return response.transactions;
          })
        : undefined;

    if (!sampleSignature && transactionsForAccount && transactionsForAccount.length > 0) {
        sampleSignature = encodeSignature(transactionsForAccount[0].getSignature());
        sampleTransactionSignature = sampleSignature;
    }

    if (sampleSignature) {
        await runStep(`Fetch transaction ${sampleSignature}`, async () => {
            const transaction = await sdk.transactions.get(sampleSignature!);
            logTransactionSummary(transaction);
            return transaction;
        });

        await runStep(`Fetch raw transaction ${sampleSignature}`, async () => {
            const raw = await sdk.transactions.getRaw(sampleSignature!);
            console.log(` - Raw transaction bytes: ${raw.rawTransaction.length}`);
            return raw;
        });

        await runStep(`Fetch transaction status ${sampleSignature}`, async () => {
            const status = await sdk.transactions.getStatus(sampleSignature!);
            console.log(` - Consensus status: ${consensusStatusLabel(status.statusCode)}`);
            return status;
        });

        await runStep(`Track transaction ${sampleSignature}`, async () => {
            const stream = sdk.transactions.track(sampleSignature!, { timeoutMs: 5000 });
            await streamWithLimit(stream, 3, "track", (update) => {
                logTrackUpdate(update);
            });
        });
    } else {
        console.log("\n(No transaction signature available for detailed transaction tests)");
    }

    await runStep("Stream recent transactions", async () => {
        const stream = sdk.transactions.stream({ signal: AbortSignal.timeout(5000) });
        await streamWithLimit(stream, 2, "transactions", ({ transaction }, index) => {
            console.log(` - Streamed transaction #${index + 1} signature=${encodeSignature(transaction.getSignature())}`);
        });
    });

    let sampleEventId: string | undefined;
    await runStep("Stream chain events", async () => {
        const stream = sdk.events.stream({ signal: AbortSignal.timeout(5000) });
        await streamWithLimit(stream, 1, "events", ({ event }) => {
            logEventSummary(event);
            sampleEventId = event.id;
        });
    });

    if (sampleEventId) {
        await runStep(`Fetch event ${sampleEventId}`, async () => {
            const event = await sdk.events.get(sampleEventId!);
            logEventSummary(event);
            return event;
        });
    }

    if (sampleAccountAddress && finalizedSlot !== undefined) {
        await sleep(2000);
        await runStep(`Generate state proof for ${sampleAccountAddress}`, async () => {
            const proof = await sdk.proofs.generate({
                address: sampleAccountAddress!,
                proofType: StateProofType.EXISTING,
                targetSlot: finalizedSlot,
            });
            const proofBytes = proof.proof;
            console.log(` - Proof bytes: ${proofBytes.length}`);
            return proof;
        });
    }

    await runStep("Helpers round-trip demo", async () => {
        if (!sampleAccountAddress) {
            console.log(" - No sample account address available");
            return;
        }
        const decoded = sdk.helpers.decodeAddress(sampleAccountAddress);
        console.log(` - Decoded address bytes: ${decoded.length}`);
        console.log(` - Re-encoded address matches: ${sdk.helpers.encodeAddress(decoded) === sampleAccountAddress}`);
        const derived = sdk.helpers.deriveProgramAddress({
            programAddress: sampleAccountAddress,
            seed: "catchall-demo",
        });
        console.log(` - Derived program address: ${derived.address}`);
        if (latestBlock?.header?.blockHash?.length) {
            const blockHash = sdk.helpers.toBlockHash(latestBlock.header.blockHash);
            console.log(` - Block hash proto bytes: ${blockHash.value.length}`);
        }
        if (sampleSignature) {
            const signatureBytes = sdk.helpers.decodeSignature(sampleSignature);
            const signatureProto = sdk.helpers.toSignature(signatureBytes);
            console.log(` - Signature proto bytes: ${signatureProto.value.length}`);
            console.log(` - Signature round trip: ${sdk.helpers.encodeSignature(signatureProto.value) === sampleSignature}`);
        }
        const pubkeyProto = sdk.helpers.toPubkey(decoded, "demoAddress");
        console.log(` - Pubkey proto bytes: ${pubkeyProto.value.length}`);
    });

    const envFeePayerPublicKey = FEE_PAYER_ADDRESS ? sdk.helpers.decodeAddress(FEE_PAYER_ADDRESS) : undefined;
    const envFeePayerPrivateKey = FEE_PAYER_PRIVATE_KEY_HEX
        ? (() => {
              try {
                  return hexToBytes(FEE_PAYER_PRIVATE_KEY_HEX);
              } catch (error) {
                  console.warn(`Invalid THRU_FEE_PAYER_PRIVATE_KEY_HEX: ${formatError(error)}`);
                  return undefined;
              }
          })()
        : undefined;

    if (envFeePayerPublicKey && envFeePayerPrivateKey) {
        const demoProgram = demoKeyPair?.publicKey ?? envFeePayerPublicKey;

        const builtTransaction = await runStep("Build demo transaction", async () => {
            const transaction = await sdk.transactions.build({
                feePayer: {
                    publicKey: envFeePayerPublicKey,
                },
                program: demoProgram,
                header: {
                    fee: 0n,
                    computeUnits: 1000,
                    stateUnits: 0,
                    memoryUnits: 0,
                    expiryAfter: 50,
                },
                accounts: {
                    readWrite: [envFeePayerPublicKey],
                },
                instructionData: new Uint8Array([0x00]),
            });
            logTransactionSummary(transaction);
            return transaction;
        });

        const signedTransaction = await runStep("Build and sign demo transaction", async () => {
            const result = await sdk.transactions.buildAndSign({
                feePayer: {
                    publicKey: envFeePayerPublicKey,
                    privateKey: envFeePayerPrivateKey,
                },
                program: demoProgram,
                header: {
                    fee: 0n,
                    computeUnits: 1000,
                    stateUnits: 0,
                    memoryUnits: 0,
                    expiryAfter: 50,
                },
                accounts: {
                    readWrite: [envFeePayerPublicKey],
                },
                instructionData: new Uint8Array([0x01, 0x02, 0x03]),
            });
            console.log(` - Local signature bytes: ${result.signature.length}`);
            return result;
        });

        if (signedTransaction) {
            await runStep("Send signed transaction", async () => {
                const signature = await sdk.transactions.send(signedTransaction.rawTransaction);
                console.log(` - Submitted signature: ${signature}`);
                return signature;
            });

            await runStep("Batch send signed transaction", async () => {
                const response = await sdk.transactions.batchSend([signedTransaction.rawTransaction]);
                const accepted = response.accepted.map((value, index) => ({
                    index,
                    accepted: value,
                    signature: encodeSignature(response.signatures[index]?.value ?? undefined),
                }));
                console.log(" - Batch submission results:", accepted);
                return response;
            });
        }

        if (builtTransaction) {
            await runStep("Serialize built transaction", async () => {
                const raw = builtTransaction.toWire();
                console.log(` - Raw transaction length: ${raw.length}`);
                return raw;
            });
        }
    } else {
        console.log("\n(Transaction build/send demo skipped — set THRU_FEE_PAYER_ADDRESS and THRU_FEE_PAYER_PRIVATE_KEY_HEX)");
    }

    console.log("\nCatch-all script complete");
}

main().catch((error) => {
    console.error(`Fatal error: ${formatError(error)}`);
    if (nodeProcess) {
        nodeProcess.exitCode = 1;
    }
});
