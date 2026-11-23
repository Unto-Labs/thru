/** Every status word in the spec maps to its typed error (§5.3, §5.2). */
import { describe, expect, it } from 'vitest';

import {
  InvalidRequestError,
  ThruLedgerError,
  UnknownStatusWordError,
  statusWordToError,
} from '../errors';
import { Ins, StatusWord, statusWordName } from '../protocol';
import { SW_TABLE } from './helpers/sw-table';

describe('statusWordToError', () => {
  it('covers every named status word except OK', () => {
    const covered = new Set(SW_TABLE.map(([sw]) => sw));
    for (const [name, sw] of Object.entries(StatusWord)) {
      if (sw === StatusWord.OK) continue;
      expect(covered.has(sw), name).toBe(true);
    }
  });

  it.each(SW_TABLE.map(([sw, cls, reason]) => [statusWordName(sw), sw, cls, reason] as const))(
    '%s maps to its typed error',
    (_name, sw, cls, reason) => {
      const err = statusWordToError(sw);
      expect(err).toBeInstanceOf(cls);
      expect(err).toBeInstanceOf(ThruLedgerError);
      expect(err).toBeInstanceOf(Error);
      expect(err.statusWord).toBe(sw);
      expect(err._tag).toBe(err.constructor.name);
      expect(err.hint.length).toBeGreaterThan(0);
      if (reason !== undefined) expect((err as unknown as { reason: string }).reason).toBe(reason);
    },
  );

  it('maps 0x6804 from SIGN_EOA_AUTH to an invalid request', () => {
    const err = statusWordToError(0x6804, { ins: Ins.SIGN_EOA_AUTH });
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect((err as InvalidRequestError).reason).toBe('chain_id_zero');
  });

  it('maps 0x6A80-0x6A8F (other than 0x6A86) and unknown words to UnknownStatusWord', () => {
    for (let sw = 0x6a80; sw <= 0x6a8f; sw++) {
      if (sw === 0x6a86) continue;
      expect(statusWordToError(sw)).toBeInstanceOf(UnknownStatusWordError);
    }
    expect(statusWordToError(0x6800)).toBeInstanceOf(UnknownStatusWordError);
    expect(statusWordToError(0x1234).message).toContain('0x1234');
  });

  it('gives actionable hints for the §11.5 errors', () => {
    expect(statusWordToError(0x5515).hint).toMatch(/unlock/i);
    expect(statusWordToError(0x6e01).hint).toMatch(/open the thru app/i);
    expect(statusWordToError(0x6808).hint).toMatch(/blind signing/i);
    expect(statusWordToError(0x6810).hint).toMatch(/fee payer/i);
    expect(statusWordToError(0x6820).hint).toMatch(/44'\/8478'/);
  });
});
