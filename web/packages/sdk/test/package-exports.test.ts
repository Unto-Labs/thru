import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const hasBuiltCjs = existsSync(new URL("../dist/sdk.cjs", import.meta.url));
const describeBuilt = hasBuiltCjs ? describe : describe.skip;
const require = createRequire(import.meta.url);

describeBuilt("CommonJS package exports", () => {
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
