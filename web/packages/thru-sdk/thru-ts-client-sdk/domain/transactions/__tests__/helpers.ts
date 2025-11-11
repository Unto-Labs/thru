import { ACCOUNT_META_FOOTPRINT, STATE_PROOF_HEADER_SIZE } from "../../../wire-format";

export function buildCreationProof(): Uint8Array {
    const header = new Uint8Array(STATE_PROOF_HEADER_SIZE);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const typeSlot = 2n << 62n; // creation
    view.setBigUint64(0, typeSlot, true);
    // path_bitset all zeros

    const existingPubkey = new Uint8Array(32).fill(0x11);
    const existingHash = new Uint8Array(32).fill(0x22);

    return concatUint8Arrays(header, existingPubkey, existingHash);
}

export function buildExistingProof(includeMeta: boolean): { proof: Uint8Array; meta?: Uint8Array } {
    const header = new Uint8Array(STATE_PROOF_HEADER_SIZE);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const typeSlot = 0n << 62n; // existing
    view.setBigUint64(0, typeSlot, true);

    const proof = concatUint8Arrays(header);

    if (!includeMeta) {
        return { proof };
    }

    const meta = new Uint8Array(ACCOUNT_META_FOOTPRINT);
    meta.fill(0x44);
    return { proof, meta };
}

export function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
