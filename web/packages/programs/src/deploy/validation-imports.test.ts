import type { Thru } from "@thru/sdk/client";
import { describe, expect, it, vi } from "vitest";

import { validateABI } from "./validation";

const IMPORT_ADDRESS =
  "ta1blxgaYR0dei5aldWJe1vbUtt-LkVEBOzNJtSRhHQcTG";

function abiAccount(contents: string): Uint8Array {
  const encoded = new TextEncoder().encode(contents);
  const data = new Uint8Array(45 + encoded.length);
  const view = new DataView(data.buffer);
  view.setBigUint64(32, 0n, true);
  data[40] = 1;
  view.setUint32(41, encoded.length, true);
  data.set(encoded, 45);
  return data;
}

describe("deployment ABI import validation", () => {
  it("resolves imports with the target-chain client and preserves root YAML", async () => {
    const dependency = `
abi:
  package: test.dependency
  abi-version: 1
  package-version: "1.0.0"
  description: dependency
  imports: []
types: []
`;
    const root = `
abi:
  package: test.root
  abi-version: 1
  package-version: "1.0.0"
  description: root
  imports:
    - type: onchain
      address: ${IMPORT_ADDRESS}
      target: abi
      network: mainnet
      revision: latest
types: []
`;
    const getRaw = vi.fn(async () => ({
      rawData: abiAccount(dependency),
    }));
    const client = { accounts: { getRaw } } as unknown as Thru;

    await expect(
      validateABI(new TextEncoder().encode(root), client),
    ).resolves.toBe(root);
    expect(getRaw).toHaveBeenCalledOnce();
  });
});
