import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
    consensusStatusToString,
    currentOrHistoricalVersionContext,
    currentVersionContext,
    slotSeqVersionContext,
    slotVersionContext,
    timestampVersionContext,
    versionContext,
} from "../consensus";
import { ConsensusStatus, VersionContextSchema } from "@thru/sdk/proto";

describe("consensus module", () => {
    it("creates current version context", () => {
        const ctx = currentVersionContext();
        expect(ctx.version?.case).toBe("current");
    });

    it("creates current or historical context", () => {
        const ctx = currentOrHistoricalVersionContext();
        expect(ctx.version?.case).toBe("currentOrHistorical");
    });

    it("creates slot-based context", () => {
        const ctx = slotVersionContext(42);
        expect(ctx.version?.case).toBe("slot");
        expect(ctx.version?.value).toBe(42n);
    });

    it("creates slot-seq-based context", () => {
        const ctx = slotSeqVersionContext(3, 7n);
        expect(ctx.version?.case).toBe("slotSeq");
        expect(ctx.version?.value?.slot).toBe(3n);
        expect(ctx.version?.value?.seq).toBe(7n);
    });

    it("creates timestamp-based context", () => {
        const ctx = timestampVersionContext(new Date(1_000));
        expect(ctx.version?.case).toBe("timestamp");
        expect(ctx.version?.value?.seconds).toBe(1n);
    });

    it("reuses provided proto", () => {
        const proto = create(VersionContextSchema, {
            version: { case: "slot", value: 10n },
        });
        expect(versionContext(proto)).toBe(proto);
    });

    it("builds context from selector objects", () => {
        expect(versionContext({ current: true }).version?.case).toBe("current");
        expect(versionContext({ slot: 5 }).version?.value).toBe(5n);
    });

    it("stringifies consensus statuses", () => {
        expect(consensusStatusToString(ConsensusStatus.INCLUDED)).toBe("INCLUDED");
    });
});

