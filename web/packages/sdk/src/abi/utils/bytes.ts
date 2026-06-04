export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function alignUp(offset: number, alignment: number): number {
  return (offset + alignment - 1) & ~(alignment - 1);
}

export function hexToBytes(hex: string): Uint8Array {
  let normalized = hex.trim().replace(/[\s_]/g, "");
  if (normalized.startsWith("0x") || normalized.startsWith("0X")) {
    normalized = normalized.slice(2);
  }
  if (normalized.length === 0) return new Uint8Array();
  if (normalized.length % 2 !== 0) {
    throw new Error("Hex input must contain an even number of characters");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    const byte = Number.parseInt(normalized.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("Hex input contains non-hexadecimal characters");
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}

export function toUint8Array(
  input: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (Array.isArray(input)) {
    return Uint8Array.from(input);
  }
  throw new TypeError("Unsupported buffer input");
}
