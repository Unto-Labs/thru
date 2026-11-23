/** Compile-time contracts (checked by `tsc --noEmit`; the runtime test is trivial). */
import { type Thru } from '@thru/sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { type LedgerThruClient, type ThruLedgerError } from '../index';

describe('types', () => {
  it('the SDK client satisfies LedgerThruClient', () => {
    expectTypeOf<Thru>().toExtend<LedgerThruClient>();
    expect(true).toBe(true);
  });

  it('ThruLedgerError satisfies DMK DmkError', () => {
    expectTypeOf<ThruLedgerError>().toExtend<{ readonly _tag: string; originalError?: unknown; message?: string }>();
  });
});
