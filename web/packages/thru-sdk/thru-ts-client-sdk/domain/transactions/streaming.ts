import { ConsensusStatus } from "../../proto/thru/common/v1/consensus_pb";
import type { Transaction as ProtoTransaction } from "../../proto/thru/core/v1/transaction_pb";
import type { TrackTransactionResponse } from "../../proto/thru/services/v1/streaming_service_pb";
import { consensusStatusToString } from "../../utils/utils";
import { Transaction } from "./Transaction";

export type StreamTransactionUpdate =
    | {
          kind: "partial";
          signature: Uint8Array;
          slot?: bigint;
          executionResult?: ReturnType<typeof Transaction.executionResultFromProto>;
      }
    | {
          kind: "full";
          transaction: Transaction;
      };

export function toStreamTransactionUpdate(proto: ProtoTransaction): StreamTransactionUpdate {
    const signatureBytes = proto.signature?.value ? new Uint8Array(proto.signature.value) : new Uint8Array();
    const executionResult = proto.executionResult
        ? Transaction.executionResultFromProto(proto.executionResult)
        : undefined;

    if (!proto.header) {
        return {
            kind: "partial",
            signature: signatureBytes,
            slot: proto.slot,
            executionResult,
        };
    }

    return {
        kind: "full",
        transaction: Transaction.fromProto(proto),
    };
}

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
