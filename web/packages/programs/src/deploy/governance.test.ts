import type { Thru } from "@thru/sdk/client";
import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../core-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core-manager")>()),
  inspectCoreGovernance: vi.fn(async () => ({ admin: "core-admin", adminKind: "multisig" })),
}));
vi.mock("./validation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./validation")>()),
  validateABI: vi.fn(async () => undefined),
  resolveSigner: vi.fn(async () => ({})),
}));
vi.mock("./uploader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./uploader")>()),
  uploadArtifact: vi.fn(async () => { calls.push("upload-start"); await new Promise((resolve) => setTimeout(resolve, 5)); calls.push("upload-finalized"); }),
}));
vi.mock("../abi-manager/governance", () => ({
  buildGovernedABIOperationPlan: vi.fn(async ({ operation }: { operation: { proof?: Uint8Array } }) => { calls.push("plan"); return { operation }; }),
}));

import { prepareGovernedABIDeployment } from "./governance";

describe("governed ABI content deployment", () => {
  it("generates a proof callback's CREATING proof only after the ABI buffer is uploaded", async () => {
    const proof = new Uint8Array([7]);
    const { plan } = await prepareGovernedABIDeployment({
      client: {} as Thru, signer: { address: "signer", privateKey: new Uint8Array(32) }, seed: "thru-program:1", abi: new Uint8Array([1]),
      action: "createContent", uploadSeed: "abi:c:test", proof: async () => { calls.push("proof"); return proof; },
    });
    expect(calls).toEqual(["upload-start", "upload-finalized", "proof", "plan"]);
    expect((plan as unknown as { operation: { proof: Uint8Array } }).operation.proof).toBe(proof);
  });
});
