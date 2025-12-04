
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { TransactionHeaderInput } from "../domain/transactions";
import { BlockSelector } from "../modules/helpers";
import { ConsensusStatus } from "../proto/thru/common/v1/consensus_pb";


export function isSlotSelector(selector: BlockSelector): selector is { slot: number | bigint } {
    return "slot" in selector;
}

export function mergeTransactionHeader(
    defaults: TransactionHeaderInput,
    overrides?: Partial<TransactionHeaderInput>,
): TransactionHeaderInput {
    if (!overrides) {
        return defaults;
    }

    const sanitized = Object.fromEntries(
        Object.entries(overrides).filter(([, value]) => value !== undefined),
    ) as Partial<TransactionHeaderInput>;

    return {
        ...defaults,
        ...sanitized,
    };
}

export function timestampToNanoseconds(timestamp?: Timestamp): bigint {
    if (!timestamp) {
        return 0n;
    }
    const seconds = BigInt(timestamp.seconds ?? 0);
    const nanos = BigInt(timestamp.nanos ?? 0);
    return seconds * 1_000_000_000n + nanos;
}

export function nanosecondsToTimestamp(ns: bigint): Timestamp {
    const seconds = ns / 1_000_000_000n;
    const nanos = Number(ns % 1_000_000_000n);
    return { seconds, nanos } as Timestamp;
}

export function consensusStatusToString(status: ConsensusStatus): string {
    const lookup = ConsensusStatus as unknown as Record<number, string>;
    return lookup[status] ?? `UNKNOWN(${status})`;
}
