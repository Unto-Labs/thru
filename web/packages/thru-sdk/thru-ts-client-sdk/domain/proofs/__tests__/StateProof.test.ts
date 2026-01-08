import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { StateProof } from "../StateProof";
import { StateProofSchema } from "@thru/proto";

describe("StateProof", () => {
    it("copies proof bytes from proto", () => {
        const proto = create(StateProofSchema, {
            proof: new Uint8Array([1, 2, 3]),
            slot: 123n,
        });

        const proof = StateProof.fromProto(proto);

        expect(proof.slot).toBe(123n);
        expect(proof.proof).toEqual(new Uint8Array([1, 2, 3]));

        proto.proof[0] = 9;
        expect(proof.proof[0]).toBe(1);
    });
});

