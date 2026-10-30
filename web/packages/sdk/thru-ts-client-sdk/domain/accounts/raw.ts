import { create } from "@bufbuild/protobuf";
import { AccountSchema, type Account, type RawAccount } from "@thru/sdk/proto";
import { AccountMeta } from "./abi/thru/blockchain/account/types";

const ACCOUNT_META_MAGIC = 0xc7a3;
const ACCOUNT_META_SIZE = 64;

/**
 * Decodes a RawAccount (GetRawAccount, BatchGetRawAccounts) into the Account
 * that GetAccount returns for the same version.
 */
export function rawAccountToAccount(raw: RawAccount): Account {
    const meta = raw.rawMeta.length === ACCOUNT_META_SIZE ? AccountMeta.from_array(raw.rawMeta) : null;
    if (!meta || meta.magic !== ACCOUNT_META_MAGIC) {
        throw new Error("Invalid raw account metadata");
    }
    const flags = meta.flags;
    return create(AccountSchema, {
        address: raw.address,
        meta: {
            version: meta.version,
            flags: {
                isProgram: (flags & 0x01) !== 0,
                isPrivileged: (flags & 0x02) !== 0,
                isUncompressable: (flags & 0x04) !== 0,
                isEphemeral: (flags & 0x08) !== 0,
                isDeleted: (flags & 0x10) !== 0,
                isNew: (flags & 0x20) !== 0,
                isCompressed: (flags & 0x40) !== 0,
                isNativeReceiver: (flags & 0x80) !== 0,
            },
            dataSize: meta.data_sz,
            seq: meta.seq,
            owner: { value: new Uint8Array(meta.owner.bytes) },
            balance: meta.balance,
            nonce: meta.nonce,
            lastUpdatedSlot: raw.versionContext?.slot,
        },
        data: raw.rawData === undefined ? undefined : { data: raw.rawData, compressed: (flags & 0x40) !== 0 },
        versionContext: raw.versionContext,
    });
}
