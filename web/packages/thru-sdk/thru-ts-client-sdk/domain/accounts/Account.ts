import type { ConsensusStatus } from "@thru/proto";
import type {
    Account as ProtoAccount,
    AccountData as ProtoAccountData,
    AccountFlags as ProtoAccountFlags,
    AccountMeta as ProtoAccountMeta,
    VersionContextMetadata as ProtoVersionContextMetadata,
} from "@thru/proto";
import { timestampToNanoseconds } from "../../utils/utils";
import { Pubkey } from "../primitives";

export interface AccountFlagsData {
    isProgram: boolean;
    isPrivileged: boolean;
    isUncompressable: boolean;
    isEphemeral: boolean;
    isDeleted: boolean;
    isNew: boolean;
    isCompressed: boolean;
}

export class AccountFlags implements AccountFlagsData {
    readonly isProgram: boolean;
    readonly isPrivileged: boolean;
    readonly isUncompressable: boolean;
    readonly isEphemeral: boolean;
    readonly isDeleted: boolean;
    readonly isNew: boolean;
    readonly isCompressed: boolean;

    constructor(flags?: Partial<AccountFlagsData>) {
        this.isProgram = flags?.isProgram ?? false;
        this.isPrivileged = flags?.isPrivileged ?? false;
        this.isUncompressable = flags?.isUncompressable ?? false;
        this.isEphemeral = flags?.isEphemeral ?? false;
        this.isDeleted = flags?.isDeleted ?? false;
        this.isNew = flags?.isNew ?? false;
        this.isCompressed = flags?.isCompressed ?? false;
    }

    static fromProto(flags?: ProtoAccountFlags): AccountFlags {
        if (!flags) {
            return new AccountFlags();
        }
        return new AccountFlags({
            isProgram: flags.isProgram,
            isPrivileged: flags.isPrivileged,
            isUncompressable: flags.isUncompressable,
            isEphemeral: flags.isEphemeral,
            isDeleted: flags.isDeleted,
            isNew: flags.isNew,
            isCompressed: flags.isCompressed,
        });
    }
}

export class AccountMeta {
    readonly version: number;
    readonly flags: AccountFlags;
    readonly dataSize: number;
    readonly seq: bigint;
    readonly owner?: Pubkey;
    readonly balance: bigint;
    readonly nonce?: bigint;

    constructor(params: {
        version: number;
        flags?: AccountFlags;
        dataSize: number;
        seq: bigint;
        owner?: Pubkey;
        balance: bigint;
        nonce?: bigint;
    }) {
        this.version = params.version;
        this.flags = params.flags ?? new AccountFlags();
        this.dataSize = params.dataSize;
        this.seq = params.seq;
        this.owner = params.owner;
        this.balance = params.balance;
        this.nonce = params.nonce;
    }

    static fromProto(meta?: ProtoAccountMeta): AccountMeta | undefined {
        if (!meta) {
            return undefined;
        }
        return new AccountMeta({
            version: meta.version,
            flags: AccountFlags.fromProto(meta.flags),
            dataSize: meta.dataSize,
            seq: meta.seq ?? 0n,
            owner: meta.owner ? Pubkey.fromProtoPubkey(meta.owner) : undefined,
            balance: meta.balance ?? 0n,
            nonce: meta.nonce,
        });
    }
}

export class AccountData {
    readonly data?: Uint8Array;
    readonly compressed: boolean;
    readonly compressionAlgorithm?: string;

    constructor(params: { data?: Uint8Array; compressed?: boolean; compressionAlgorithm?: string }) {
        this.data = params.data ? new Uint8Array(params.data) : undefined;
        this.compressed = params.compressed ?? false;
        this.compressionAlgorithm = params.compressionAlgorithm;
    }

    static fromProto(data?: ProtoAccountData): AccountData | undefined {
        if (!data) {
            return undefined;
        }
        return new AccountData({
            data: data.data ? new Uint8Array(data.data) : undefined,
            compressed: data.compressed ?? false,
            compressionAlgorithm: data.compressionAlgorithm,
        });
    }
}

export interface AccountVersionContext {
    slot?: bigint;
    blockTimestampNs?: bigint;
}

export class Account {
    readonly address: Pubkey;
    readonly meta?: AccountMeta;
    readonly data?: AccountData;
    readonly versionContext?: AccountVersionContext;
    readonly consensusStatus?: ConsensusStatus;

    constructor(params: {
        address: Pubkey;
        meta?: AccountMeta;
        data?: AccountData;
        versionContext?: AccountVersionContext;
        consensusStatus?: ConsensusStatus;
    }) {
        this.address = params.address;
        this.meta = params.meta;
        this.data = params.data;
        this.versionContext = params.versionContext;
        this.consensusStatus = params.consensusStatus;
    }

    static fromProto(proto: ProtoAccount): Account {
        if (!proto.address) {
            throw new Error("Account proto missing address");
        }

        return new Account({
            address: Pubkey.fromProtoPubkey(proto.address),
            meta: AccountMeta.fromProto(proto.meta),
            data: AccountData.fromProto(proto.data ?? undefined),
            versionContext: convertVersionContext(proto.versionContext),
            consensusStatus: proto.consensusStatus,
        });
    }
}

function convertVersionContext(meta?: ProtoVersionContextMetadata): AccountVersionContext | undefined {
    if (!meta) {
        return undefined;
    }

    return {
        slot: meta.slot,
        blockTimestampNs: timestampToNanoseconds(meta.blockTimestamp),
    };
}
