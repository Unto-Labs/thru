/** The part of a generated account root (`account_type` + `payload` enum) the
    decoders need. */
interface AccountRootView {
  payloadVariant(): { readonly payloadSize: number | null } | null;
}

/**
 * Decodes program-owned account data through a generated account root. Byte 0
 * is the account type; the root rejects an unknown or zero type and a buffer
 * too short for that type's payload. A fixed-size kind must also match its
 * size exactly (no trailing bytes). Returns null when the data is not a valid
 * account of that program.
 */
export function decodeAccountRoot<T extends AccountRootView>(
  data: Uint8Array,
  fromArray: (data: Uint8Array) => T | null
): T | null {
  const parsed = fromArray(data);
  if (!parsed) return null;
  const variant = parsed.payloadVariant();
  if (!variant) return null;
  if (variant.payloadSize !== null && data.length !== 1 + variant.payloadSize) return null;
  return parsed;
}
