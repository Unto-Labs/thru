import { create } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

import {
    CurrentOrHistoricalVersionSchema,
    CurrentVersionSchema,
    VersionContext,
    VersionContextSchema,
} from "@thru/proto";
import { consensusStatusToString } from "../utils/utils";

export type VersionContextInput =
    | VersionContext
    | { current: true }
    | { currentOrHistorical: true }
    | { slot: number | bigint }
    | { timestamp: Date | number | Timestamp }
    | { seq: number | bigint };

export { consensusStatusToString };

export function currentVersionContext(): VersionContext {
    return create(VersionContextSchema, {
        version: { case: "current", value: create(CurrentVersionSchema) },
    });
}

export function currentOrHistoricalVersionContext(): VersionContext {
    return create(VersionContextSchema, {
        version: { case: "currentOrHistorical", value: create(CurrentOrHistoricalVersionSchema) },
    });
}

export function slotVersionContext(slot: number | bigint): VersionContext {
    return create(VersionContextSchema, {
        version: { case: "slot", value: toUint64(slot, "slot") },
    });
}

export function timestampVersionContext(value: Date | number | Timestamp): VersionContext {
    return create(VersionContextSchema, {
        version: { case: "timestamp", value: normalizeTimestamp(value) },
    });
}

export function seqVersionContext(seq: number | bigint): VersionContext {
    return create(VersionContextSchema, {
        version: { case: "seq", value: toUint64(seq, "seq") },
    });
}

export function versionContext(input?: VersionContextInput): VersionContext {
    if (!input) {
        return currentVersionContext();
    }
    if ("version" in input) {
        return input;
    }
    if ("current" in input) {
        return currentVersionContext();
    }
    if ("currentOrHistorical" in input) {
        return currentOrHistoricalVersionContext();
    }
    if ("slot" in input) {
        return slotVersionContext(input.slot);
    }
    if ("timestamp" in input) {
        return timestampVersionContext(input.timestamp);
    }
    if ("seq" in input) {
        return seqVersionContext(input.seq);
    }
    throw new Error("Version context input must specify current, slot, timestamp, or seq");
}

function toUint64(value: number | bigint, field: string): bigint {
    if (typeof value === "bigint") {
        if (value < 0n) {
            throw new Error(`${field} must be non-negative`);
        }
        return value;
    }
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        throw new Error(`${field} must be a non-negative integer`);
    }
    return BigInt(value);
}

function normalizeTimestamp(value: Date | number | Timestamp): Timestamp {
    if (value instanceof Date) {
        const ms = value.getTime();
        return {
            seconds: BigInt(Math.floor(ms / 1000)),
            nanos: (ms % 1000) * 1_000_000,
        } as Timestamp;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error("timestamp must be a finite number");
        }
        const ms = Math.trunc(value);
        return {
            seconds: BigInt(Math.floor(ms / 1000)),
            nanos: (ms % 1000) * 1_000_000,
        } as Timestamp;
    }
    if (typeof value === "object" && value !== null) {
        return value;
    }
    throw new Error("timestamp must be a Date, number, or protobuf Timestamp");
}

