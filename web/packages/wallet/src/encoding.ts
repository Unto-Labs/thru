const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BASE64_LOOKUP = new Map<string, number>(
  [...BASE64_ALPHABET].map((char, index) => [char, index]),
);

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length === 0) return new Uint8Array();
  if (normalized.length % 4 === 1) {
    throw new Error("Invalid base64 data");
  }

  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const padding = padded.endsWith("==") ? 2 : padded.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((padded.length / 4) * 3 - padding);
  let outIdx = 0;

  for (let i = 0; i < padded.length; i += 4) {
    const chars = padded.slice(i, i + 4);
    const a = BASE64_LOOKUP.get(chars[0]);
    const b = BASE64_LOOKUP.get(chars[1]);
    const c = chars[2] === "=" ? 0 : BASE64_LOOKUP.get(chars[2]);
    const d = chars[3] === "=" ? 0 : BASE64_LOOKUP.get(chars[3]);
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Error("Invalid base64 data");
    }

    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (outIdx < output.length) output[outIdx++] = (chunk >> 16) & 0xff;
    if (outIdx < output.length) output[outIdx++] = (chunk >> 8) & 0xff;
    if (outIdx < output.length) output[outIdx++] = chunk & 0xff;
  }

  return output;
}
