import type { ConsensusStatus } from "../../proto/thru/common/v1/consensus_pb";
import type {
    Account as CoreAccount,
    AccountData as CoreAccountData,
    AccountFlags as CoreAccountFlags,
    AccountMeta as CoreAccountMeta,
    VersionContextMetadata as CoreVersionContextMetadata,
} from "../../proto/thru/core/v1/account_pb";
import { timestampToNanoseconds } from "../../utils/utils";
import type { AccountAddress } from "../transactions/types";
import { protoPubkeyToAccountAddress } from "../transactions/utils";

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

    static fromProto(flags?: CoreAccountFlags): AccountFlags {
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
    readonly owner?: AccountAddress;
    readonly balance: bigint;
    readonly nonce?: bigint;

    constructor(params: {
        version: number;
        flags?: AccountFlags;
        dataSize: number;
        seq: bigint;
        owner?: AccountAddress;
        balance: bigint;
        nonce?: bigint;
    }) {
        this.version = params.version;
        this.flags = params.flags ?? new AccountFlags();
        this.dataSize = params.dataSize;
        this.seq = params.seq;
        this.owner = params.owner ? copyKey(params.owner) : undefined;
        this.balance = params.balance;
        this.nonce = params.nonce;
    }

    static fromProto(meta?: CoreAccountMeta): AccountMeta | undefined {
        if (!meta) {
            return undefined;
        }
        return new AccountMeta({
            version: meta.version,
            flags: AccountFlags.fromProto(meta.flags),
            dataSize: meta.dataSize,
            seq: meta.seq ?? 0n,
            owner: protoPubkeyToAccountAddress(meta.owner),
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

    static fromProto(data?: CoreAccountData): AccountData | undefined {
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
    readonly address: AccountAddress;
    readonly meta?: AccountMeta;
    readonly data?: AccountData;
    readonly versionContext?: AccountVersionContext;
    readonly consensusStatus?: ConsensusStatus;

    constructor(params: {
        address: AccountAddress;
        meta?: AccountMeta;
        data?: AccountData;
        versionContext?: AccountVersionContext;
        consensusStatus?: ConsensusStatus;
    }) {
        this.address = copyKey(params.address);
        this.meta = params.meta;
        this.data = params.data;
        this.versionContext = params.versionContext;
        this.consensusStatus = params.consensusStatus;
    }

    static fromProto(proto: CoreAccount): Account {
        if (!proto.address) {
            throw new Error("Account proto missing address");
        }

        return new Account({
            address: protoPubkeyToAccountAddress(proto.address),
            meta: AccountMeta.fromProto(proto.meta),
            data: AccountData.fromProto(proto.data ?? undefined),
            versionContext: convertVersionContext(proto.versionContext),
            consensusStatus: proto.consensusStatus,
        });
    }
}

function convertVersionContext(meta?: CoreVersionContextMetadata): AccountVersionContext | undefined {
    if (!meta) {
        return undefined;
    }

    return {
        slot: meta.slot,
        blockTimestampNs: timestampToNanoseconds(meta.blockTimestamp),
    };
}

function copyKey(source: AccountAddress): AccountAddress {
    const bytes = new Uint8Array(source.length);
    bytes.set(source);
    return bytes;
}

