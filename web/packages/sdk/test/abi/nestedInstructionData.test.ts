import { describe, expect, it } from "vitest";
import {
  resolveNestedInstructionData,
  type FormattedReflection,
} from "../../src/abi";

function reflection(value: unknown, typeName: string): FormattedReflection {
  return {
    typeName,
    kind: "struct",
    value: value as FormattedReflection["value"],
  };
}

function instructionData(programIndex: number, dataHex: string): Record<string, unknown> {
  return {
    programIndex,
    dataHex,
    dataSize: dataHex.replace(/^0x/i, "").length / 2,
    _pendingReflection: true,
  };
}

describe("resolveNestedInstructionData", () => {
  it("decodes a nested instruction data node", async () => {
    const root = reflection(
      { invoke: instructionData(2, "0x0102") },
      "RootInstruction",
    );

    const result = await resolveNestedInstructionData(
      root,
      ["fee", "root", "token"],
      (programAddress, data) => {
        expect(programAddress).toBe("token");
        expect(Array.from(data)).toEqual([0x01, 0x02]);
        return reflection({ amount: 42 }, "TransferInstruction");
      },
    );

    const invoke = result.value.invoke as Record<string, unknown>;
    expect(invoke.programAddress).toBe("token");
    expect(invoke.decodeError).toBeUndefined();
    expect((invoke.decodedInstruction as FormattedReflection).typeName).toBe(
      "TransferInstruction",
    );
  });

  it("walks arrays, objects, and variant payloads", async () => {
    let decodeCount = 0;
    const root = reflection(
      {
        calls: [instructionData(2, "0x01")],
        wrapper: {
          variant: "invoke",
          value: instructionData(2, "0x02"),
        },
      },
      "RootInstruction",
    );

    const result = await resolveNestedInstructionData(
      root,
      ["fee", "root", "token"],
      (_programAddress, data) => {
        decodeCount += 1;
        return reflection({ dataHex: `0x${hexString(data)}` }, "Nested");
      },
    );

    expect(result.value.calls[0].decodedInstruction).toBeDefined();
    expect(result.value.wrapper.value.decodedInstruction).toBeDefined();
    expect(decodeCount).toBe(2);
  });

  it("stops at the depth cap", async () => {
    const result = await resolveNestedInstructionData(
      reflection({ first: instructionData(2, "0x01") }, "RootInstruction"),
      ["fee", "root", "p1", "p2"],
      () => reflection({ child: instructionData(3, "0x02") }, "Level1"),
      { maxDepth: 1 },
    );

    const child = result.value.first.decodedInstruction.value.child;
    expect(child.decodedInstruction).toBeUndefined();
    expect(child.decodeError).toBe("Nested instruction depth limit reached");
  });

  it("records invalid program index and missing ABI as nonfatal errors", async () => {
    const invalidIndex = await resolveNestedInstructionData(
      reflection({ invoke: instructionData(9, "0x0102") }, "RootInstruction"),
      ["fee", "root"],
      () => {
        throw new Error("decoder should not run");
      },
    );
    expect(invalidIndex.value.invoke.decodeError).toBe("Invalid program index 9");

    const missingAbi = await resolveNestedInstructionData(
      reflection({ invoke: instructionData(2, "0x0102") }, "RootInstruction"),
      ["fee", "root", "token"],
      () => null,
    );
    expect(missingAbi.value.invoke.programAddress).toBe("token");
    expect(missingAbi.value.invoke.decodeError).toBe(
      "ABI unavailable for program token",
    );
  });

  it("ignores lookalike objects that were not marked by the InstructionData handler", async () => {
    let decodeCount = 0;
    const result = await resolveNestedInstructionData(
      reflection(
        {
          notInstructionData: {
            programIndex: 2,
            dataHex: "0x0102",
          },
        },
        "RootInstruction",
      ),
      ["fee", "root", "token"],
      () => {
        decodeCount += 1;
        return reflection({ amount: 42 }, "TransferInstruction");
      },
    );

    expect(decodeCount).toBe(0);
    expect(result.value.notInstructionData.decodedInstruction).toBeUndefined();
    expect(result.value.notInstructionData.decodeError).toBeUndefined();
  });
});

function hexString(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
