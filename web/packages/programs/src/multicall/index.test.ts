import { describe, expect, it } from 'vitest';
import {
  MULTICALL_PROGRAM_ADDRESS,
  MULTICALL_PROGRAM_PUBKEY,
  InstructionDataBuilder,
  MulticallArgs,
  buildMulticallInstruction,
} from './index';

function instructionData(programIdx: number, data: Uint8Array): number[] {
  const builder = new InstructionDataBuilder();
  builder.set_program_idx(programIdx);
  builder.data().write(data).finish();
  return Array.from(builder.build());
}

describe('multicall helpers', () => {
  it('encodes calls with generated InstructionData views', () => {
    expect(MULTICALL_PROGRAM_ADDRESS).toBe(
      'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAkJ'
    );
    expect(MULTICALL_PROGRAM_PUBKEY[31]).toBe(9);

    const encoded = buildMulticallInstruction([
      { programIdx: 2, instructionData: new Uint8Array([0xaa]) },
      { programIdx: 5, instructionData: new Uint8Array([0xbb, 0xcc]) },
    ]);

    expect(encoded).toEqual(
      new Uint8Array([
        0x02, 0x00,
        ...instructionData(2, new Uint8Array([0xaa])),
        ...instructionData(5, new Uint8Array([0xbb, 0xcc])),
      ])
    );

    const validation = MulticallArgs.validate(encoded);
    expect(validation).toMatchObject({ ok: true, consumed: encoded.length });

    const view = MulticallArgs.from_array(encoded);
    expect(view?.get_calls_count()).toBe(2);
    const calls = view?.get_calls();
    expect(calls?.map((call) => call.get_program_idx())).toEqual([2, 5]);
    expect(calls?.map((call) => call.get_data())).toEqual([[0xaa], [0xbb, 0xcc]]);
  });
});
