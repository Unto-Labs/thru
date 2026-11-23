import { TxnStreamParser, type TxnParseResult } from '../../protocol';
import { PUBKEY0 } from './fixtures';

/** Feed `body` in chunks of `size`, returning the verdict exactly as the device would. */
export function streamed(
  body: Uint8Array,
  size: number,
  pubkey: Uint8Array = PUBKEY0,
): TxnParseResult | { ok: false; sw: number; reason: string } {
  const p = new TxnStreamParser({ derivedPubkey: pubkey });
  for (let off = 0; off < body.length; off += size) {
    const f = p.feed(body.subarray(off, off + size));
    if (f !== null) return { ok: false, sw: f.sw, reason: f.reason };
  }
  return p.finish();
}
