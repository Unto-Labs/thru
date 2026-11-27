import { describe, expect, it } from 'vitest';
import { AbiManagerError } from './abi-manager/abi/thru/program/abi_manager/types';
import { AmmError } from './amm/abi/thru/program/amm/types';
import { ClobError } from './clob/abi/thru/program/clob/types';
import { CompressionError } from './compression/abi/thru/program/compression/types';
import { CoreManagerError } from './core-manager/abi/thru/program/core_manager/types';
import { FaucetError } from './faucet/abi/thru/program/faucet/types';
import { ManagerError } from './manager/abi/thru/program/manager/types';
import { MultisigError } from './multisig/abi/thru/program/multisig/types';
import { OracleError } from './oracle/abi/thru/program/oracle/types';
import { PerpError } from './perp/abi/thru/program/perp/types';
import { TokenError } from './token/abi/thru/program/token/types';
import { UploaderError } from './uploader/abi/thru/program/uploader/types';
import { PasskeyError } from './wallet/abi/thru/program/wallet/types';

interface ErrorView {
  get_code(): number | bigint;
  errorVariant(): { name: string } | null;
}

interface ErrorType {
  readonly name: string;
  readonly errorVariantDescriptors: readonly { name: string; tag: number | bigint; payloadSize: number }[];
  builder(): object;
  from_array(bytes: Uint8Array): ErrorView | null;
}

/* Every generated program error type: a `code` tag (u64, or u16 for the
   two managers) and the `error` enum it selects. */
const ERROR_TYPES: readonly [ErrorType, number][] = [
  [FaucetError, 8],
  [ManagerError, 2],
  [AbiManagerError, 2],
  [CoreManagerError, 8],
  [MultisigError, 8],
  [PerpError, 8],
  [AmmError, 8],
  [ClobError, 8],
  [CompressionError, 8],
  [OracleError, 8],
  [TokenError, 8],
  [UploaderError, 8],
  [PasskeyError, 8],
];

function build(type: ErrorType, variant: string, payloadSize: number): Uint8Array {
  const builder = type.builder() as Record<string, (payload: Uint8Array) => { build(): Uint8Array }>;
  return builder[`select_${variant}`](new Uint8Array(payloadSize)).build();
}

describe('generated program error builders', () => {
  it.each(ERROR_TYPES.map(([type, codeSize]) => [type.name, type, codeSize] as const))(
    '%s builds every variant and decodes it back',
    (_name, type, codeSize) => {
      expect(type.errorVariantDescriptors.length).toBeGreaterThan(0);
      for (const descriptor of type.errorVariantDescriptors) {
        const bytes = build(type, descriptor.name, descriptor.payloadSize);
        expect(bytes.length).toBe(codeSize + descriptor.payloadSize);
        const view = type.from_array(bytes);
        expect(view).not.toBeNull();
        expect(BigInt(view!.get_code())).toBe(BigInt(descriptor.tag));
        expect(view!.errorVariant()?.name).toBe(descriptor.name);
      }
    },
  );

  it('writes a u64 code little-endian (faucet)', () => {
    const bytes = FaucetError.builder().select_transfer_failed(new Uint8Array()).build();
    expect(Array.from(bytes)).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
    expect(FaucetError.builder().select_create_failed(new Uint8Array()).finish().errorVariant()?.name).toBe(
      'create_failed',
    );
  });

  it('writes a u16 code little-endian (manager)', () => {
    const [descriptor] = ManagerError.errorVariantDescriptors.filter((variant) => Number(variant.tag) > 0xff);
    expect(descriptor).toBeDefined();
    const bytes = build(ManagerError, descriptor.name, 0);
    expect(new DataView(bytes.buffer).getUint16(0, true)).toBe(Number(descriptor.tag));
  });
});
