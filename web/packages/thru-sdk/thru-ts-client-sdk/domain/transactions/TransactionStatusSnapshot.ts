import { ConsensusStatus } from "../../proto/thru/common/v1/consensus_pb";
import type { TransactionStatus } from "../../proto/thru/services/v1/query_service_pb";
import { consensusStatusToString } from "../../utils/utils";
import { Transaction } from "./Transaction";

export interface TransactionStatusParams {
    signature: Uint8Array;
    consensusStatus?: ConsensusStatus;
    executionResult?: ReturnType<typeof Transaction.executionResultFromProto>;
}

export class TransactionStatusSnapshot {
    readonly signature: Uint8Array;
    readonly statusCode?: ConsensusStatus;
    readonly status?: string;
    readonly executionResult?: ReturnType<typeof Transaction.executionResultFromProto>;

    constructor(params: TransactionStatusParams) {
        this.signature = copyBytes(params.signature);
        this.statusCode = params.consensusStatus;
        this.status = params.consensusStatus != null ? consensusStatusToString(params.consensusStatus) : undefined;
        this.executionResult = params.executionResult;
    }

    static fromProto(proto: TransactionStatus): TransactionStatusSnapshot {
        if (!proto.signature?.value) {
            throw new Error("TransactionStatus proto missing signature");
        }
        return new TransactionStatusSnapshot({
            signature: proto.signature.value,
            consensusStatus: proto.consensusStatus,
            executionResult: proto.executionResult
                ? Transaction.executionResultFromProto(proto.executionResult)
                : undefined,
        });
    }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy;
}

