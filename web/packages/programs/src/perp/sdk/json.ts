/* JSON-safe values: bigints as decimal strings, byte arrays as hex,
   Sets as arrays, functions dropped.  Every result the action runner
   (describe.ts) returns goes through this, so agents can log and replay it. */

export type JsonSafe = null | boolean | number | string | JsonSafe[] | { [key: string]: JsonSafe };

export function toJsonSafe(value: unknown): JsonSafe {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Uint8Array) return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (value instanceof Set) return [...value].map(toJsonSafe);
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, entry]) => [String(key), toJsonSafe(entry)]));
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === 'function') return null;
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return toJsonSafe((value as { toJSON(): unknown }).toJSON());
  const out: Record<string, JsonSafe> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'function' || entry === undefined) continue;
    out[key] = toJsonSafe(entry);
  }
  return out;
}
