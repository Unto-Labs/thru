export function decodeBase64(value: string): Uint8Array {
  if (value.length === 0) {
    return new Uint8Array();
  }
  const atobFn = globalThis.atob;
  if (!atobFn) {
    throw new Error('Base64 decoding requires globalThis.atob support');
  }
  const binary = atobFn(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function hexToBytes(value: string): Uint8Array {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (normalized.length % 2 !== 0) {
    throw new Error('Hex string must contain an even number of characters');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    const byte = parseInt(normalized.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('Hex string contains invalid characters');
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}

export function isHexString(value: string): boolean {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  return normalized.length % 2 === 0 && normalized.length > 0 && /^[0-9a-fA-F]+$/.test(normalized);
}
