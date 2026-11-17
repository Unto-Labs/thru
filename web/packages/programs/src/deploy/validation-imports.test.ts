import { Pubkey } from '@thru/sdk';
import type { Thru } from '@thru/sdk/client';
import { describe, expect, it, vi } from 'vitest';
import { validateABI } from './validation';

const IMPORT_BYTES = new Uint8Array(32).fill(0x6d);
const IMPORT_ADDRESS = Pubkey.from(IMPORT_BYTES).toThruFmt();
const dependency = `
abi:
  package: test.dependency
  abi-version: 1
  package-version: "1.0.0"
  description: synthetic user dependency
  imports: []
types:
  - name: Counter
    kind:
      struct:
        packed: true
        fields:
          - name: value
            field-type:
              primitive: u64
`;
const root = `
abi:
  package: test.root
  abi-version: 1
  package-version: "1.0.0"
  description: user program
  imports:
    - type: onchain
      address: ${IMPORT_ADDRESS}
      target: abi
      network: mainnet
      revision: latest
types:
  - name: UserState
    kind:
      struct:
        packed: true
        fields:
          - name: counter
            field-type:
              type-ref:
                name: Counter
                package: test.dependency
`;
function abiAccount(contents: string): Uint8Array {
  const encoded = new TextEncoder().encode(contents), data = new Uint8Array(46 + encoded.length);
  const view = new DataView(data.buffer);
  data[0] = 2;
  view.setBigUint64(33, 0n, true); data[41] = 1;
  view.setUint32(42, encoded.length, true); data.set(encoded, 46);
  return data;
}
describe('deployment ABI import validation', () => {
  it('resolves a used nonempty imported type through the supplied target-chain client and preserves root YAML', async () => {
    const getRaw = vi.fn(async (_address: Uint8Array, _options: unknown) => ({ rawData: abiAccount(dependency) }));
    const client = { accounts: { getRaw } } as unknown as Thru;
    await expect(validateABI(new TextEncoder().encode(root), client)).resolves.toBe(root);
    expect(getRaw).toHaveBeenCalledOnce();
    expect(getRaw.mock.calls[0]?.[0]).toEqual(IMPORT_BYTES);
  });
  it('rejects a missing on-chain dependency without a genesis or foundation cache', async () => {
    const getRaw = vi.fn(async () => { throw new Error('account not found'); });
    await expect(validateABI(new TextEncoder().encode(root), { accounts: { getRaw } } as unknown as Thru)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(getRaw).toHaveBeenCalledOnce();
  });
  it('rejects a fetched dependency which does not define the referenced type', async () => {
    const getRaw = vi.fn(async () => ({ rawData: abiAccount(dependency.replace('name: Counter', 'name: DifferentType')) }));
    await expect(validateABI(new TextEncoder().encode(root), { accounts: { getRaw } } as unknown as Thru)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(getRaw).toHaveBeenCalledOnce();
  });
});
