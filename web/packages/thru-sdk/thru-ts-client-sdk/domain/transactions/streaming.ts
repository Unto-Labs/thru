import { ConsensusStatus } from "../../proto/thru/common/v1/consensus_pb";
import type { TrackTransactionResponse } from "../../proto/thru/services/v1/streaming_service_pb";
import { consensusStatusToString } from "../../utils/utils";
import { Transaction } from "./Transaction";

export interface TrackTransactionUpdate {
    signature?: Uint8Array;
    status: string;
    statusCode: ConsensusStatus;
    executionResult?: ReturnType<typeof Transaction.executionResultFromProto>;
    transaction?: Transaction;
}

export function toTrackTransactionUpdate(response: TrackTransactionResponse): TrackTransactionUpdate {
    const signatureBytes = response.signature?.value ? new Uint8Array(response.signature.value) : undefined;
    const executionResult = response.executionResult
        ? Transaction.executionResultFromProto(response.executionResult)
        : undefined;

    return {
        signature: signatureBytes,
        status: consensusStatusToString(response.consensusStatus),
        statusCode: response.consensusStatus,
        executionResult,
        transaction: undefined,
    };
}
