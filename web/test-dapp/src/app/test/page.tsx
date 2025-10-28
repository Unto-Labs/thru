"use client";

import {
    getCreateCounterInstruction,
    getIncrementCounterInstruction,
    pollForCounterData,
} from "@/components/counter";
import {
    useAccounts,
    useThru,
    useWallet,
} from "@thru/react-sdk";
import { ThruAccountSwitcher } from "@thru/react-ui";
import { ConsensusStatus } from "@thru/thru-sdk";
import Image from "next/image";
import { FormEvent, useCallback, useMemo, useState } from "react";

interface CounterState {
    seed: string;
    address: string;
    value: string | null;
    rawHex: string | null;
    lastSignature?: string;
    loading: boolean;
    incrementing: boolean;
    error?: string;
    isAnimating?: boolean;
}

const COUNTER_PROGRAM_ADDRESS =
    "taXP9YQR-M_1xg_jCh61aVpnMzAy0nqIfMA6waQXUMqfrL";

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export default function TestCounterPage() {
    const { thru } = useThru();
    const { wallet, isConnected } = useWallet();
    const { selectedAccount } = useAccounts()

    const feePayerAddress = selectedAccount?.address;
    const feePayerPublicKey = useMemo(() => {
        if (!thru || !feePayerAddress) {
            return undefined;
        }
        try {
            return thru.helpers.decodeAddress(feePayerAddress);
        } catch (error) {
            console.error("Failed to decode fee payer address", error);
            return undefined;
        }
    }, [thru, feePayerAddress]);

    const [seedInput, setSeedInput] = useState("");
    const [formError, setFormError] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [counters, setCounters] = useState<CounterState[]>([]);

    const upsertCounter = useCallback(
        (seed: string, updater: (previous: CounterState | undefined) => CounterState) => {
            setCounters((prev) => {
                const index = prev.findIndex((counter) => counter.seed === seed);
                const nextState = updater(index >= 0 ? prev[index] : undefined);
                if (index >= 0) {
                    const updated = [...prev];
                    updated[index] = nextState;
                    return updated;
                }
                return [...prev, nextState];
            });
        },
        [],
    );

    const ensureWalletReady = useCallback(() => {
        if (!isConnected) {
            throw new Error("Wallet not connected");
        }
        if (!thru) {
            throw new Error("Thru SDK not ready");
        }
        if (!wallet) {
            throw new Error("Thru wallet not ready");
        }
        if (!feePayerPublicKey || !feePayerAddress) {
            throw new Error("No connected account available");
        }
    }, [feePayerAddress, feePayerPublicKey, isConnected, thru, wallet]);

    const signAndSend = useCallback(
        async (unsignedBytes: Uint8Array) => {
            ensureWalletReady();
            const unsignedBase64 = encodeBase64(unsignedBytes);
            const signedBase64 = await wallet!.signTransaction(unsignedBase64);
            const signedBytes = decodeBase64(signedBase64);
            return thru!.transactions.send(signedBytes);
        },
        [ensureWalletReady, thru, wallet],
    );

    const handleCreate = useCallback(
        async (event?: FormEvent<HTMLFormElement>) => {
            event?.preventDefault();
            const seed = seedInput.trim();
            if (!seed) {
                setFormError("Enter a counter name to use as the seed.");
                return;
            }
            setFormError(null);
            setIsCreating(true);

            try {
                ensureWalletReady();

                const derived = thru!.helpers.deriveProgramAddress({
                    programAddress: COUNTER_PROGRAM_ADDRESS,
                    seed,
                });

                upsertCounter(seed, (previous) => ({
                    seed,
                    address: derived.address,
                    value: previous?.value ?? null,
                    rawHex: previous?.rawHex ?? null,
                    lastSignature: previous?.lastSignature,
                    loading: true,
                    incrementing: false,
                    error: undefined,
                }));

                const instructionHex = await getCreateCounterInstruction(
                    thru!,
                    seed,
                    derived.address,
                );
                const transaction = await thru!.transactions.build({
                    feePayer: {
                        publicKey: feePayerPublicKey!,
                    },
                    program: COUNTER_PROGRAM_ADDRESS,
                    header: {
                        fee: 0n,
                    },
                    accounts: {
                        readWrite: [derived.address],
                    },
                    content: {
                        instructions: instructionHex,
                    },
                });

                const unsignedBytes = transaction.toWireForSigning();
                const submittedSignature = await signAndSend(unsignedBytes);
                const details = await pollForCounterData(thru!, derived.address);
                if (!details) {
                    throw new Error(
                        "Counter created but account data is not yet available.",
                    );
                }

                upsertCounter(seed, () => ({
                    seed,
                    address: derived.address,
                    value: details.value,
                    rawHex: details.rawHex,
                    lastSignature: submittedSignature,
                    loading: false,
                    incrementing: false,
                    error: undefined,
                    isAnimating: false,
                }));
                setSeedInput("");
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : "Failed to create counter.";
                upsertCounter(seed, (previous) => ({
                    seed,
                    address: previous?.address ?? "",
                    value: previous?.value ?? null,
                    rawHex: previous?.rawHex ?? null,
                    lastSignature: previous?.lastSignature,
                    loading: false,
                    incrementing: false,
                    error: message,
                    isAnimating: previous?.isAnimating ?? false,
                }));
            } finally {
                setIsCreating(false);
            }
        },
        [ensureWalletReady, feePayerPublicKey, thru, seedInput, signAndSend, upsertCounter],
    );

    const handleIncrement = useCallback(
        async (counter: CounterState) => {
            const seed = counter.seed;
            upsertCounter(seed, (previous) => ({
                seed,
                address: previous?.address ?? counter.address,
                value: previous?.value ?? counter.value,
                rawHex: previous?.rawHex ?? counter.rawHex,
                lastSignature: previous?.lastSignature ?? counter.lastSignature,
                loading: true,
                incrementing: true,
                error: undefined,
                isAnimating: previous?.isAnimating ?? false,
            }));

            try {
                ensureWalletReady();

                const instructionHex = await getIncrementCounterInstruction();
                const transaction = await thru!.transactions.build({
                    feePayer: {
                        publicKey: feePayerPublicKey!,
                    },
                    program: COUNTER_PROGRAM_ADDRESS,
                    header: {
                        fee: 0n,
                    },
                    accounts: {
                        readWrite: [counter.address],
                    },
                    content: {
                        instructions: instructionHex,
                    },
                });

                const unsignedBytes = transaction.toWireForSigning();
                const submittedSignature = await signAndSend(unsignedBytes);

                for await (const update of thru!.transactions.track(
                    submittedSignature,
                    {
                        timeoutMs: 60_000,
                    },
                )) {
                    if (
                        update.consensusStatus === ConsensusStatus.FINALIZED ||
                        update.consensusStatus === ConsensusStatus.CLUSTER_EXECUTED
                    ) {
                        break;
                    }
                }

                const details = await pollForCounterData(thru!, counter.address);

                upsertCounter(seed, (previous) => ({
                    seed,
                    address: counter.address,
                    value: details?.value ?? previous?.value ?? counter.value,
                    rawHex: details?.rawHex ?? previous?.rawHex ?? counter.rawHex,
                    lastSignature: submittedSignature,
                    loading: false,
                    incrementing: false,
                    error: details
                        ? undefined
                        : "Counter incremented, but new data is not yet available.",
                    isAnimating: true,
                }));

                const animationResetMs = 1700;
                window.setTimeout(() => {
                    upsertCounter(seed, (previous) => {
                        if (!previous) {
                            return {
                                seed,
                                address: counter.address,
                                value: details?.value ?? counter.value,
                                rawHex: details?.rawHex ?? counter.rawHex,
                                lastSignature: submittedSignature,
                                loading: false,
                                incrementing: false,
                                error: undefined,
                                isAnimating: false,
                            };
                        }
                        return {
                            ...previous,
                            isAnimating: false,
                        };
                    });
                }, animationResetMs);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : "Failed to increment counter.";
                upsertCounter(seed, (previous) => ({
                    seed,
                    address: counter.address,
                    value: previous?.value ?? counter.value,
                    rawHex: previous?.rawHex ?? counter.rawHex,
                    lastSignature: previous?.lastSignature ?? counter.lastSignature,
                    loading: false,
                    incrementing: false,
                    error: message,
                    isAnimating: previous?.isAnimating ?? false,
                }));
            }
        },
        [ensureWalletReady, feePayerPublicKey, thru, signAndSend, upsertCounter],
    );

    if (!thru || !wallet) {
        return <div>Connect the Thru wallet to interact with the counter demo.</div>;
    }

    return (
        <>
            <div>
                <div
                    style={{
                        maxWidth: "1200px",
                        margin: "24px auto",
                        padding: "0 24px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <div>
                        <h1 style={{ margin: 0, fontWeight: 'bold', fontSize: "32px", color: "#fff" }}>Heeger Pumper</h1>
                        <div style={{ marginTop: 4, color: "#b2cdf2ff", fontSize: "16px" }}>
                            Create and pump your Heegers on-chain
                        </div>
                    </div>
                    <div>
                        <ThruAccountSwitcher />
                    </div>
                </div>
                <div
                    style={{
                        display: "flex",
                        gap: "24px",
                        alignItems: "flex-start",
                        padding: "24px",
                        maxWidth: "1200px",
                        margin: "0 auto",
                    }}
                >
                    <div
                        style={{
                            flex: "0 0 320px",
                            padding: "16px",
                            border: "1px solid #e2e8f0",
                            borderRadius: "12px",
                            backgroundColor: "#ffffff",
                            boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
                        }}
                    >
                        <form
                            onSubmit={handleCreate}
                            style={{ display: "flex", flexDirection: "column", gap: "12px", color: "#0f172a" }}
                        >
                            <div>
                                <label
                                    htmlFor="counterSeed"
                                    style={{ display: "block", fontWeight: 600, marginBottom: "4px" }}
                                >
                                    Your Heeger&apos;s Name
                                </label>
                                <input
                                    id="counterSeed"
                                    type="text"
                                    value={seedInput}
                                    onChange={(event) => setSeedInput(event.target.value)}
                                    placeholder="e.g. Scott"
                                    style={{
                                        width: "100%",
                                        padding: "8px 12px",
                                        borderRadius: "8px",
                                        border: "1px solid #cbd5f5",
                                        fontSize: "14px",
                                    }}
                                />
                            </div>
                            {formError ? (
                                <div style={{ color: "#dc2626", fontSize: "13px" }}>{formError}</div>
                            ) : (
                                <div style={{ color: "#64748b", fontSize: "12px" }}>
                                    The seed is used to derive the counter address on chain.
                                </div>
                            )}
                            <button
                                type="submit"
                                disabled={isCreating}
                                style={{
                                    padding: "10px 12px",
                                    borderRadius: "8px",
                                    border: "none",
                                    backgroundColor: isCreating ? "#94a3b8" : "#2563eb",
                                    color: "#ffffff",
                                    fontWeight: 600,
                                    cursor: isCreating ? "not-allowed" : "pointer",
                                }}
                            >
                                {isCreating ? "Creating..." : "Create a Heeger"}
                            </button>
                        </form>
                    </div>

                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
                        {counters.length === 0 ? (
                            <div
                                style={{
                                    padding: "32px",
                                    border: "1px dashed #cbd5f5",
                                    borderRadius: "12px",
                                    textAlign: "center",
                                    color: "#475569",
                                }}
                            >
                                Create a counter to see its account data and send increment instructions.
                            </div>
                        ) : (
                            counters.map((counter) => (
                                <div
                                    key={counter.seed}
                                    style={{
                                        border: "1px solid #e2e8f0",
                                        borderRadius: "12px",
                                        padding: "20px",
                                        backgroundColor: "#ffffff",
                                        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "12px",
                                    }}
                                >

                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            flexWrap: "wrap",
                                            gap: "8px",
                                        }}
                                    >
                                        <div>
                                            <div style={{ display: 'flex' }}>
                                                <div >
                                                    <Image
                                                        width={40}
                                                        height={40}
                                                        style={{
                                                            borderRadius: '50%',
                                                            marginRight: 10,
                                                            animation: counter.isAnimating ? 'heegerPumpSpin 0.3s ease-in-out 0s 5' : undefined,
                                                        }}
                                                        src={'https://i.postimg.cc/0N8jggxz/Screenshot-2025-10-22-at-5-19-19-PM.png'}
                                                        alt={""} />
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: "16px", color: "#0f172a" }}>
                                                        {counter.seed}
                                                    </div>
                                                    <div style={{ fontSize: "12px", color: "#64748b" }}>{counter.address}</div>
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleIncrement(counter)}
                                            disabled={counter.incrementing || counter.loading}
                                            style={{
                                                padding: "8px 14px",
                                                borderRadius: "8px",
                                                border: "none",
                                                backgroundColor:
                                                    counter.incrementing || counter.loading ? "#94a3b8" : "#16a34a",
                                                color: "#ffffff",
                                                fontWeight: 600,
                                                cursor:
                                                    counter.incrementing || counter.loading ? "not-allowed" : "pointer",
                                            }}
                                        >
                                            {counter.incrementing ? "Pumping..." : "Pump Heeger"}
                                        </button>
                                    </div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "minmax(140px, 200px) 1fr",
                                            gap: "8px",
                                            rowGap: "12px",
                                        }}
                                    >
                                        <span style={{ fontWeight: 600, color: "#475569" }}>Heegers</span>
                                        <span style={{ color: "#475569" }}>{counter.value ?? "—"}</span>
                                        <span style={{ fontWeight: 600, color: "#475569" }}>Raw heeger</span>
                                        <code style={{ fontSize: "12px", color: "#0f172a", wordBreak: "break-all" }}>
                                            {counter.rawHex ?? "n/a"}
                                        </code>
                                        {counter.lastSignature ? (
                                            <>
                                                <span style={{ fontWeight: 600, color: "#475569" }}>Last signature</span>
                                                <code style={{ fontSize: "12px", color: "#0f172a", wordBreak: "break-all" }}>
                                                    {counter.lastSignature}
                                                </code>
                                            </>
                                        ) : null}
                                        {counter.loading ? (
                                            <>
                                                <span style={{ fontWeight: 600, color: "#475569" }}>Status</span>
                                                <span style={{ color: "#2563eb" }}>Waiting for account data…</span>
                                            </>
                                        ) : null}
                                        {counter.error ? (
                                            <>
                                                <span style={{ fontWeight: 600, color: "#475569" }}>Error</span>
                                                <span style={{ color: "#dc2626" }}>{counter.error}</span>
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
            <style jsx global>{`
            @keyframes heegerPumpSpin {
                0% {
                    transform: scale(1) rotate(0deg);
                }
                30% {
                    transform: scale(2.2) rotate(22deg);
                }
                60% {
                    transform: scale(0.95) rotate(-18deg);
                }
                100% {
                    transform: scale(1) rotate(0deg);
                }
            }
        `}</style>
        </>
    );
}
