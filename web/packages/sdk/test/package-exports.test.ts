import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as canonicalAddresses from "../src/core-program-addresses";

const hasBuiltCjs = existsSync(new URL("../dist/sdk.cjs", import.meta.url));
const describeBuilt = hasBuiltCjs ? describe : describe.skip;
const require = createRequire(import.meta.url);

describeBuilt("CommonJS package exports", () => {
  it("exports canonical program defaults through CJS and ESM", async () => {
    const cjs = require("@thru/sdk");
    const esm = await import("../dist/sdk.js");
    for (const [name, address] of Object.entries(canonicalAddresses)) {
      expect(cjs[name]).toBe(address);
      expect(esm[name as keyof typeof esm]).toBe(address);
    }
    expect(cjs.Pubkey.from(cjs.eoa.EOA_PROGRAM_ADDRESS).toThruFmt()).toBe(canonicalAddresses.EOA_PROGRAM_ID);
    expect(esm.Pubkey.from(esm.eoa.EOA_PROGRAM_ADDRESS).toThruFmt()).toBe(canonicalAddresses.EOA_PROGRAM_ID);
    expect(canonicalAddresses.EOA_PROGRAM_ID).toBe("taEOAD2uLK1SLzPgtabFLUAx22yDlBs9DE9nZFTOESIGRr");
  });
  const specifiers = [
    "@thru/sdk",
    "@thru/sdk/client",
    "@thru/sdk/proto",
    "@thru/sdk/helpers",
    "@thru/sdk/crypto",
    "@thru/sdk/abi",
  ];

  for (const specifier of specifiers) {
    it(`loads ${specifier} with require`, () => {
      expect(() => require(specifier)).not.toThrow();
    });
  }
});
