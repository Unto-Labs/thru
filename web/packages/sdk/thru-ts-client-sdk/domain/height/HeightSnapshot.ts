export interface HeightSnapshotParams {
    finalized: bigint;
    locallyExecuted: bigint;
    clusterExecuted: bigint;
}

export class HeightSnapshot {
    readonly finalized: bigint;
    readonly locallyExecuted: bigint;
    readonly clusterExecuted: bigint;

    constructor(params: HeightSnapshotParams) {
        this.finalized = params.finalized;
        this.locallyExecuted = params.locallyExecuted;
        this.clusterExecuted = params.clusterExecuted;
    }

    static fromProto(proto: { finalized: bigint; locallyExecuted: bigint; clusterExecuted: bigint }): HeightSnapshot {
        return new HeightSnapshot({
            finalized: proto.finalized ?? 0n,
            locallyExecuted: proto.locallyExecuted ?? 0n,
            clusterExecuted: proto.clusterExecuted ?? 0n,
        });
    }

    delta(other: HeightSnapshot): { finalized: bigint; locallyExecuted: bigint; clusterExecuted: bigint } {
        return {
            finalized: this.finalized - other.finalized,
            locallyExecuted: this.locallyExecuted - other.locallyExecuted,
            clusterExecuted: this.clusterExecuted - other.clusterExecuted,
        };
    }
}

