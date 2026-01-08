import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { VersionInfo } from "../VersionInfo";
import { GetVersionResponseSchema } from "@thru/proto";

describe("VersionInfo", () => {
    it("hydrates from proto versions map", () => {
        const proto = create(GetVersionResponseSchema, {
            versions: {
                "thru-node": "1.2.3",
                "thru-rpc": "0.9.0",
            },
        });

        const info = VersionInfo.fromProto(proto);

        expect(info.get("thru-node")).toBe("1.2.3");
        expect(info.get("thru-rpc")).toBe("0.9.0");
    });
});

