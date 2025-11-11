import type { AccountPage as ProtoAccountPage } from "../../proto/thru/core/v1/account_pb";
import type { AccountUpdate as ProtoAccountUpdate, StreamAccountUpdatesResponse } from "../../proto/thru/services/v1/streaming_service_pb";
import { Account, AccountMeta } from "./Account";

export interface AccountPageChunk {
    pageIndex: number;
    pageSize: number;
    data: Uint8Array;
    compressed?: boolean;
    compressionAlgorithm?: string;
}

export interface AccountSnapshot {
    account: Account;
}

export interface AccountUpdateDelta {
    slot: bigint;
    meta?: AccountMeta;
    page?: AccountPageChunk;
    deleted?: boolean;
}

export type StreamAccountUpdate =
    | { kind: "snapshot"; snapshot: AccountSnapshot }
    | { kind: "update"; update: AccountUpdateDelta };

export function toStreamAccountUpdate(response: StreamAccountUpdatesResponse): StreamAccountUpdate | undefined {
    if (!response.message) {
        return undefined;
    }

    if (response.message.case === "snapshot") {
        return {
            kind: "snapshot",
            snapshot: { account: Account.fromProto(response.message.value) },
        };
    }

    if (response.message.case === "update") {
        return {
            kind: "update",
            update: fromProtoUpdate(response.message.value),
        };
    }

    return undefined;
}

function fromProtoUpdate(update: ProtoAccountUpdate): AccountUpdateDelta {
    return {
        slot: update.slot,
        meta: AccountMeta.fromProto(update.meta),
        page: update.page ? fromProtoPage(update.page) : undefined,
        deleted: update.delete ?? false,
    };
}

function fromProtoPage(page: ProtoAccountPage): AccountPageChunk {
    return {
        pageIndex: page.pageIdx,
        pageSize: page.pageSize,
        data: new Uint8Array(page.pageData),
        compressed: page.compressed ?? undefined,
        compressionAlgorithm: page.compressionAlgorithm,
    };
}
