import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RawAccountSchema } from "@thru/sdk/proto";
import { rawAccountToAccount } from "../raw";

function rawMeta(magic = 0xc7a3): Uint8Array {
    const bytes = new Uint8Array(64);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, magic, true);
    bytes[2] = 1;
    bytes[3] = 0x10 | 0x40 | 0x80;
    view.setUint32(4, 73, true);
    view.setBigUint64(8, 9n, true);
    bytes.fill(0xaa, 16, 48);
    view.setBigUint64(48, 1_000n, true);
    view.setBigUint64(56, 3n, true);
    return bytes;
}

describe("rawAccountToAccount", () => {
    it("decodes runtime metadata into the GetAccount shape", () => {
        const account = rawAccountToAccount(create(RawAccountSchema, {
            address: { value: new Uint8Array(32).fill(0x11) },
            rawMeta: rawMeta(),
            rawData: new Uint8Array([7, 8]),
            versionContext: { slot: 42n },
        }));

        expect(account.address?.value).toEqual(new Uint8Array(32).fill(0x11));
        expect(account.meta?.version).toBe(1);
        expect(account.meta?.dataSize).toBe(73);
        expect(account.meta?.seq).toBe(9n);
        expect(account.meta?.owner?.value).toEqual(new Uint8Array(32).fill(0xaa));
        expect(account.meta?.balance).toBe(1_000n);
        expect(account.meta?.nonce).toBe(3n);
        expect(account.meta?.lastUpdatedSlot).toBe(42n);
        expect(account.meta?.flags).toMatchObject({ isDeleted: true, isCompressed: true, isNew: false, isProgram: false, isNativeReceiver: true });
        expect(account.data?.data).toEqual(new Uint8Array([7, 8]));
        expect(account.versionContext?.slot).toBe(42n);
    });

    it("does not infer native receipt opt-in from other flags", () => {
        const meta = rawMeta();
        meta[3] = 0x7f;
        const account = rawAccountToAccount(create(RawAccountSchema, { rawMeta: meta }));
        expect(account.meta?.flags?.isNativeReceiver).toBe(false);
        expect(account.meta?.flags?.isCompressed).toBe(true);
    });

    it("leaves data unset when the response carried none", () => {
        const account = rawAccountToAccount(create(RawAccountSchema, { rawMeta: rawMeta() }));
        expect(account.data).toBeUndefined();
        expect(account.meta?.dataSize).toBe(73);
    });

    it("rejects metadata with the wrong magic or length", () => {
        expect(() => rawAccountToAccount(create(RawAccountSchema, { rawMeta: rawMeta(0x1234) }))).toThrow("Invalid raw account metadata");
        expect(() => rawAccountToAccount(create(RawAccountSchema, { rawMeta: new Uint8Array(63) }))).toThrow("Invalid raw account metadata");
    });
});
