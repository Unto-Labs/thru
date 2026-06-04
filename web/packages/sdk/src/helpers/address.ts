import { BASE64_URL_ALPHABET, BASE64_URL_MAP } from "./constants";

export function encodeAddress(bytes: Uint8Array): string {
  if (bytes.length !== 32) {
    throw new Error('Expected 32-byte address');
  }

  let checksum = 0;
  let accumulator = 0;
  let bitsCollected = 0;
  const output: string[] = ['t', 'a'];

  for (let i = 0; i < 30; i++) {
    const byte = bytes[i];
    checksum += byte;
    accumulator = ((accumulator << 8) | byte) >>> 0;
    bitsCollected += 8;
    while (bitsCollected >= 6) {
      const index = (accumulator >> (bitsCollected - 6)) & 0x3f;
      output.push(BASE64_URL_ALPHABET[index]);
      bitsCollected -= 6;
      accumulator &= maskForBits(bitsCollected);
    }
  }

  const secondLast = bytes[30];
  checksum += secondLast;
  accumulator = ((accumulator << 8) | secondLast) >>> 0;
  bitsCollected += 8;

  const last = bytes[31];
  checksum += last;
  accumulator = ((accumulator << 8) | last) >>> 0;
  bitsCollected += 8;

  accumulator = ((accumulator << 8) | (checksum & 0xff)) >>> 0;
  bitsCollected += 8;

  while (bitsCollected >= 6) {
    const index = (accumulator >> (bitsCollected - 6)) & 0x3f;
    output.push(BASE64_URL_ALPHABET[index]);
    bitsCollected -= 6;
    accumulator &= maskForBits(bitsCollected);
  }

  return output.join('');
}

export function decodeAddress(value: string): Uint8Array {
  if (value.length !== 46) {
    throw new Error('Invalid address length');
  }
  if (!value.startsWith('ta')) {
    throw new Error('Address must start with "ta"');
  }

  const output = new Uint8Array(32);
  let checksum = 0;
  let inIdx = 2;
  let remaining = 40;
  let outIdx = 0;

  while (remaining >= 4) {
    const a = BASE64_URL_MAP[value.charCodeAt(inIdx)];
    const b = BASE64_URL_MAP[value.charCodeAt(inIdx + 1)];
    const c = BASE64_URL_MAP[value.charCodeAt(inIdx + 2)];
    const d = BASE64_URL_MAP[value.charCodeAt(inIdx + 3)];
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new Error('Invalid address encoding');
    }
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    const byte1 = (triple >> 16) & 0xff;
    const byte2 = (triple >> 8) & 0xff;
    const byte3 = triple & 0xff;
    checksum += byte1;
    checksum += byte2;
    checksum += byte3;
    output[outIdx++] = byte1;
    output[outIdx++] = byte2;
    output[outIdx++] = byte3;
    inIdx += 4;
    remaining -= 4;
  }

  const a = BASE64_URL_MAP[value.charCodeAt(inIdx)];
  const b = BASE64_URL_MAP[value.charCodeAt(inIdx + 1)];
  const c = BASE64_URL_MAP[value.charCodeAt(inIdx + 2)];
  const d = BASE64_URL_MAP[value.charCodeAt(inIdx + 3)];
  if (a < 0 || b < 0 || c < 0 || d < 0) {
    throw new Error('Invalid address encoding');
  }
  const triple = (a << 18) | (b << 12) | (c << 6) | d;
  const byte1 = (triple >> 16) & 0xff;
  const byte2 = (triple >> 8) & 0xff;
  const incomingChecksum = triple & 0xff;

  checksum += byte1;
  checksum += byte2;
  output[outIdx++] = byte1;
  output[outIdx++] = byte2;

  checksum &= 0xff;
  if (checksum !== incomingChecksum) {
    throw new Error('Address checksum mismatch');
  }

  return output;
}

function maskForBits(bits: number): number {
  return bits === 0 ? 0 : (1 << bits) - 1;
}
