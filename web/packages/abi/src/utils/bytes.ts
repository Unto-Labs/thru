export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function alignUp(offset: number, alignment: number): number {
  return (offset + alignment - 1) & ~(alignment - 1);
}
