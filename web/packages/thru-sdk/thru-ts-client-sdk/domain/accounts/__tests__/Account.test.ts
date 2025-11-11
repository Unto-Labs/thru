import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { createMockAccount, createMockAccountFlags, createMockAccountMeta, generateTestPubkey } from "../../../__tests__/helpers/test-utils";
import { ConsensusStatus } from "../../../proto/thru/common/v1/consensus_pb";
import { AccountDataSchema, AccountSchema, VersionContextMetadataSchema } from "../../../proto/thru/core/v1/account_pb";
import { Account, AccountData, AccountFlags, AccountMeta } from "../";

describe("Account domain model", () => {
    it("converts proto account into domain instance", () => {
        const address = generateTestPubkey(0x33);
        const metaProto = createMockAccountMeta({
            balance: 500n,
            nonce: 7n,
            owner: { value: generateTestPubkey(0xaa) },
            flags: createMockAccountFlags({ isProgram: true, isCompressed: true }),
        });
        const dataProto = create(AccountDataSchema, {
            data: new Uint8Array([1, 2, 3]),
            compressed: true,
            compressionAlgorithm: "gzip",
        });
        const proto = create(AccountSchema, {
            address: { value: address },
            meta: metaProto,
            data: dataProto,
            versionContext: create(VersionContextMetadataSchema, {
                slot: 99n,
                blockTimestamp: { seconds: 2n, nanos: 5 },
            }),
            consensusStatus: ConsensusStatus.FINALIZED,
        });

        const account = Account.fromProto(proto);

        expect(account).toBeInstanceOf(Account);
        expect(account.address).toEqual(address);
        expect(account.meta).toBeInstanceOf(AccountMeta);
        expect(account.meta?.flags).toBeInstanceOf(AccountFlags);
        expect(account.meta?.flags.isProgram).toBe(true);
        expect(account.meta?.flags.isCompressed).toBe(true);
        expect(account.meta?.balance).toBe(500n);
        expect(account.data).toBeInstanceOf(AccountData);
        expect(account.data?.compressed).toBe(true);
        expect(account.data?.data).toEqual(new Uint8Array([1, 2, 3]));
        expect(account.versionContext?.slot).toBe(99n);
        expect(account.versionContext?.blockTimestampNs).toBe(2n * 1_000_000_000n + 5n);
        expect(account.consensusStatus).toBe(ConsensusStatus.FINALIZED);
    });

    it("handles missing optional fields gracefully", () => {
        const proto = create(AccountSchema, {
            address: { value: generateTestPubkey(0x22) },
        });

        const account = Account.fromProto(proto);

        expect(account.meta).toBeUndefined();
        expect(account.data).toBeUndefined();
        expect(account.versionContext).toBeUndefined();
    });

    it("defensively copies mutable buffers", () => {
        const data = new Uint8Array([9, 8, 7]);
        const proto = create(AccountSchema, {
            address: { value: generateTestPubkey(0x11) },
            data: create(AccountDataSchema, { data }),
        });

        const account = Account.fromProto(proto);

        expect(account.data?.data).toEqual(data);
        data[0] = 0;
        expect(account.data?.data?.[0]).toBe(9);
    });
});

