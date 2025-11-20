import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { Filter, FilterParamValue } from "../";
import {
    generateTestAddress,
    generateTestPubkey,
    generateTestSignature,
    generateTestSignatureString,
} from "../../../__tests__/helpers/test-utils";
import { FilterParamValueSchema, FilterSchema } from "../../../proto/thru/common/v1/filters_pb";

describe("Filter domain model", () => {
    it("creates a domain filter from proto", () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const proto = create(FilterSchema, {
            expression: "slot > params.min_slot",
            params: {
                min_slot: create(FilterParamValueSchema, {
                    kind: {
                        case: "intValue",
                        value: 1000n,
                    },
                }),
                owner: create(FilterParamValueSchema, {
                    kind: {
                        case: "bytesValue",
                        value: bytes,
                    },
                }),
            },
        });

        const filter = Filter.fromProto(proto);

        expect(filter).toBeInstanceOf(Filter);
        expect(filter.expression).toBe("slot > params.min_slot");
        expect(filter.hasParam("min_slot")).toBe(true);
        expect(filter.getParam("min_slot")?.getInt()).toBe(1000n);

        const ownerBytes = filter.getParam("owner")?.getBytes();
        expect(ownerBytes).toEqual(bytes);
        if (!ownerBytes) {
            throw new Error("Expected owner bytes");
        }
        ownerBytes[0] = 9;
        expect(filter.getParam("owner")?.getBytes()).toEqual(bytes);
    });

    it("serializes to proto", () => {
        const filter = new Filter({
            expression: "meta.owner.value == params.owner_bytes",
            params: {
                owner_bytes: FilterParamValue.bytes(new Uint8Array([0xaa, 0xbb])),
                is_program: FilterParamValue.bool(true),
            },
        });

        const proto = filter.toProto();

        expect(proto.expression).toBe("meta.owner.value == params.owner_bytes");
        expect(proto.params.owner_bytes?.kind.case).toBe("bytesValue");
        expect(proto.params.owner_bytes?.kind.value).toEqual(new Uint8Array([0xaa, 0xbb]));
        expect(proto.params.is_program?.kind.case).toBe("boolValue");
        expect(proto.params.is_program?.kind.value).toBe(true);
    });

    it("supports immutable param updates", () => {
        const original = new Filter({
            expression: "slot > params.min_slot",
            params: {
                min_slot: FilterParamValue.int(10n),
            },
        });

        const updated = original.withParam("max_slot", FilterParamValue.int(20n));

        expect(original.hasParam("max_slot")).toBe(false);
        expect(updated.hasParam("max_slot")).toBe(true);
        expect(updated.getParam("max_slot")?.getInt()).toBe(20n);

        const cleared = updated.withoutParam("min_slot");
        expect(cleared.hasParam("min_slot")).toBe(false);
        expect(updated.hasParam("min_slot")).toBe(true);
    });

    it("supports new primitive helpers", () => {
        const pubkeyBytes = generateTestPubkey();
        const pubkeyParam = FilterParamValue.pubkey(pubkeyBytes);
        expect(pubkeyParam.getPubkey()).toEqual(pubkeyBytes);
        expect(pubkeyParam.toProto().kind.case).toBe("pubkeyValue");

        const signatureBytes = generateTestSignature();
        const signatureParam = FilterParamValue.signature(signatureBytes);
        expect(signatureParam.getSignature()).toEqual(signatureBytes);
        expect(signatureParam.toProto().kind.case).toBe("signatureValue");

        const taAddress = generateTestAddress();
        const taParam = FilterParamValue.taPubkey(taAddress);
        expect(taParam.getTaPubkey()).toBe(taAddress);
        expect(taParam.toProto().kind.case).toBe("taPubkeyValue");

        const tsSignature = generateTestSignatureString();
        const tsParam = FilterParamValue.tsSignature(tsSignature);
        expect(tsParam.getTsSignature()).toBe(tsSignature);
        expect(tsParam.toProto().kind.case).toBe("tsSignatureValue");

        const uintParam = FilterParamValue.uint(42);
        expect(uintParam.getUint()).toBe(42n);
        expect(uintParam.toProto().kind.case).toBe("uintValue");
    });
});



