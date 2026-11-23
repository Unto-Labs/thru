import { ConsensusStatus } from "@thru/sdk/proto";
import type { Transaction as ProtoTransaction } from "@thru/sdk/proto";
import type { TrackTransactionResponse } from "@thru/sdk/proto";
import { consensusStatusToString } from "../../utils/utils";
import { Transaction } from "./Transaction";

export type StreamTransactionUpdate =
    | {
          kind: "partial";
          signature: Uint8Array;
          slot?: bigint;
          executionResult?: ReturnType<typeof Transaction.executionResultFromProto>;
          /** Consensus level of this publication; 0 when the server does not report it. */
          consensusStatus: ConsensusStatus;
      }
    | {
          kind: "full";
          transaction: Transaction;
          /** Consensus level of this publication; 0 when the server does not report it. */
          consensusStatus: ConsensusStatus;
      };

export function toStreamTransactionUpdate(
    proto: ProtoTransaction,
    consensusStatus: ConsensusStatus = ConsensusStatus.UNSPECIFIED,
): StreamTransactionUpdate {
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
            consensusStatus,
        };
    }

    return {
        kind: "full",
        transaction: Transaction.fromProto(proto),
        consensusStatus,
    };
}

export interface TrackTransactionUpdate {
    signature?: Uint8Array;
    status: string;
    statusCode: ConsensusStatus;
    slot?: bigint;
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
        slot: response.slot !== 0n ? response.slot : undefined,
        executionResult,
        transaction: undefined,
    };
}
