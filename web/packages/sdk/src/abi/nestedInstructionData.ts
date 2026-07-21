import type { FormattedReflection } from "./types";

export const MAX_NESTED_INSTRUCTION_DEPTH = 15;
const ABI_UNAVAILABLE_DECODE_HINT =
  "This transaction executed, but the instruction data could not be decoded because no matching ABI was available for this program.";

export interface NestedInstructionDecodeOptions {
  maxDepth?: number;
}

export type NestedInstructionDecoder = (
  programAddress: string,
  data: Uint8Array,
) => FormattedReflection | null | undefined | Promise<FormattedReflection | null | undefined>;

type JsonObject = Record<string, unknown>;

export async function resolveNestedInstructionData(
  reflection: FormattedReflection,
  accountAddresses: readonly string[],
  decoder: NestedInstructionDecoder,
  options: NestedInstructionDecodeOptions = {},
): Promise<FormattedReflection> {
  await resolveValue(
    reflection.value,
    0,
    accountAddresses,
    decoder,
    options.maxDepth ?? MAX_NESTED_INSTRUCTION_DEPTH,
  );
  return reflection;
}

async function resolveValue(
  value: unknown,
  instructionDepth: number,
  accountAddresses: readonly string[],
  decoder: NestedInstructionDecoder,
  maxDepth: number,
): Promise<void> {
  if (Array.isArray(value)) {
    for (const item of value) {
      await resolveValue(item, instructionDepth, accountAddresses, decoder, maxDepth);
    }
    return;
  }

  if (!isJsonObject(value)) return;

  if (isInstructionDataValue(value)) {
    await resolveInstructionDataValue(
      value,
      instructionDepth,
      accountAddresses,
      decoder,
      maxDepth,
    );
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "decodedInstruction") continue;
    await resolveValue(child, instructionDepth, accountAddresses, decoder, maxDepth);
  }
}

async function resolveInstructionDataValue(
  value: JsonObject,
  instructionDepth: number,
  accountAddresses: readonly string[],
  decoder: NestedInstructionDecoder,
  maxDepth: number,
): Promise<void> {
  delete value.decodeError;
  delete value.decodeHint;
  delete value.decodedInstruction;
  delete value.programAddress;

  const programIndex = value.programIndex as number;
  const dataHex = value.dataHex as string;

  if (instructionDepth >= maxDepth) {
    insertError(value, "Nested instruction depth limit reached");
    return;
  }

  const programAddress = accountAddresses[programIndex];
  if (!programAddress) {
    insertError(value, `Invalid program index ${programIndex}`);
    return;
  }
  value.programAddress = programAddress;

  let data: Uint8Array;
  try {
    data = parseHexBytes(dataHex);
  } catch (err) {
    insertError(value, `Nested instruction decode failed: ${errorMessage(err)}`);
    return;
  }

  try {
    const decoded = await decoder(programAddress, data);
    if (!decoded) {
      insertError(
        value,
        `ABI unavailable for program ${programAddress}`,
        ABI_UNAVAILABLE_DECODE_HINT,
      );
      return;
    }

    await resolveValue(
      decoded.value,
      instructionDepth + 1,
      accountAddresses,
      decoder,
      maxDepth,
    );
    value.decodedInstruction = decoded;
  } catch (err) {
    insertError(value, `Nested instruction decode failed: ${errorMessage(err)}`);
  }
}

function isInstructionDataValue(value: JsonObject): boolean {
  return (
    value._pendingReflection === true &&
    Number.isSafeInteger(value.programIndex) &&
    (value.programIndex as number) >= 0 &&
    typeof value.dataHex === "string"
  );
}

function insertError(value: JsonObject, message: string, hint?: string): void {
  value.decodeError = message;
  if (hint) {
    value.decodeHint = hint;
  } else {
    delete value.decodeHint;
  }
}

function parseHexBytes(value: string): Uint8Array {
  const hex = value.startsWith("0x") || value.startsWith("0X")
    ? value.slice(2)
    : value;

  if (hex.length % 2 !== 0) {
    throw new Error("hex payload has an odd number of digits");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let idx = 0; idx < bytes.length; idx += 1) {
    const high = decodeHexNibble(hex.charCodeAt(idx * 2));
    const low = decodeHexNibble(hex.charCodeAt(idx * 2 + 1));
    if (high === undefined || low === undefined) {
      throw new Error(`invalid hex payload at byte ${idx}`);
    }
    bytes[idx] = (high << 4) | low;
  }
  return bytes;
}

function decodeHexNibble(value: number): number | undefined {
  if (value >= 0x30 && value <= 0x39) return value - 0x30;
  if (value >= 0x61 && value <= 0x66) return value - 0x61 + 10;
  if (value >= 0x41 && value <= 0x46) return value - 0x41 + 10;
  return undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
