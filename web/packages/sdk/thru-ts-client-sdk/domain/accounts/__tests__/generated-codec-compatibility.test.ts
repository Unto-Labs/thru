import { describe, expect, it } from 'vitest';
import { AccountMeta, AccountMetaBuilder } from '../abi/thru/blockchain/account/types';
import { StateProof, StateProofBuilder } from '../../programs/compression/abi/thru/blockchain/state_proof/types';
import { MulticallArgs, MulticallArgsBuilder } from '../../programs/multicall/abi/thru/program/multicall/types';

// Byte layouts below are independent of generated code and are retained through
// local-import cutover. Run after regeneration, not only against old codecs.
describe('prepared ABI consumer wire compatibility', () => {
  it('preserves AccountMeta builder, decoder and exact field offsets', () => {
    const owner = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const expected = new Uint8Array(64);
    const view = new DataView(expected.buffer);
    view.setUint16(0, 0xabcd, true);
    view.setUint8(2, 1);
    view.setUint8(3, 0x81);
    view.setUint32(4, 123456, true);
    view.setBigUint64(8, 0xfedcba9876543210n, true);
    expected.set(owner, 16);
    view.setBigUint64(48, 0xffffffffffffffffn, true);
    view.setBigUint64(56, 17n, true);
    expect(new AccountMetaBuilder().set_magic(0xabcd).set_version(1).set_flags(0x81)
      .set_data_sz(123456).set_seq(0xfedcba9876543210n).set_owner(owner)
      .set_balance(0xffffffffffffffffn).set_nonce(17n).build()).toEqual(expected);
    const decoded = AccountMeta.from_array(expected)!;
    expect(decoded.get_magic()).toBe(0xabcd);
    expect(decoded.get_version()).toBe(1);
    expect(decoded.get_flags()).toBe(0x81);
    expect(decoded.get_data_sz()).toBe(123456);
    expect(decoded.get_seq()).toBe(0xfedcba9876543210n);
    expect(decoded.get_balance()).toBe(0xffffffffffffffffn);
    expect(decoded.get_nonce()).toBe(17n);
    expect(AccountMeta.from_array(expected.subarray(0, 63))).toBeNull();
  });

  it('encodes and decodes non-empty nested Multicall and StateProof payloads', () => {
    const header = new Uint8Array(40);
    new DataView(header.buffer).setBigUint64(0, 12345n, true);
    header[8] = 0b101; // Two sibling hashes, not a zero-length proof.
    const siblings = Uint8Array.from({ length: 64 }, (_, index) => (index * 7 + 3) & 255);
    const proofBytes = new Uint8Array(104);
    proofBytes.set(header);
    proofBytes.set(siblings, 40);
    const builder = new StateProofBuilder().set_hdr(header);
    builder.proof_body().select('existing').writePayload(siblings).finish();
    expect(builder.build()).toEqual(proofBytes);
    const proof = StateProof.from_array(proofBytes)!;
    expect(proof.get_hdr().get_type_slot()).toBe(12345n);
    expect(proof.proofBodyVariant()?.name).toBe('existing');
    expect(proof.proof_body().asExisting()!.get_sibling_hashes_length()).toBe(2);
    expect(proof.proof_body().bytes()).toEqual(siblings);

    const call = (program: number, data: Uint8Array) => {
      const bytes = new Uint8Array(10 + data.length);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, program, true);
      view.setBigUint64(2, BigInt(data.length), true);
      bytes.set(data, 10);
      return bytes;
    };
    const innerCall = call(7, proofBytes);
    const nested = new Uint8Array(2 + innerCall.length);
    new DataView(nested.buffer).setUint16(0, 1, true);
    nested.set(innerCall, 2);
    const calls = [call(3, Uint8Array.of(9, 8, 7)), call(5, nested)];
    const expected = new Uint8Array(2 + calls[0].length + calls[1].length);
    new DataView(expected.buffer).setUint16(0, calls.length, true);
    expected.set(calls[0], 2);
    expected.set(calls[1], 2 + calls[0].length);
    expect(new MulticallArgsBuilder().set_calls(calls).build()).toEqual(expected);
    const outer = MulticallArgs.from_array(expected)!;
    expect(outer.get_calls_length()).toBe(2);
    expect(outer.get_calls_at(0)!.get_program_idx()).toBe(3);
    expect(outer.get_calls_at(0)!.get_data()).toEqual([9, 8, 7]);
    const inner = MulticallArgs.from_array(Uint8Array.from(outer.get_calls_at(1)!.get_data()))!;
    expect(inner.get_calls_length()).toBe(1);
    expect(inner.get_calls_at(0)!.get_program_idx()).toBe(7);
    expect(StateProof.from_array(Uint8Array.from(inner.get_calls_at(0)!.get_data()))!.proof_body().bytes()).toEqual(siblings);
  });
});
