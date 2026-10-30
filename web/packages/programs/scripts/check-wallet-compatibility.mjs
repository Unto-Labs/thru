// Run after building @thru/sdk and @thru/programs. Exercise published paths.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as legacy from '@thru/programs/passkey-manager';
import * as current from '@thru/programs/wallet';
import { PASSKEY_MANAGER_PROGRAM_ADDRESS, WALLET_PROGRAM_ADDRESS } from '@thru/sdk';
import { AuthorityRecord as oldRecord } from '@thru/sdk/programs/passkey-manager/abi/thru/program/passkey_manager/types';
import { AuthorityRecord as newRecord } from '@thru/sdk/programs/wallet/abi/thru/program/wallet/types';
import * as oldContext from '@thru/sdk/programs/passkey-manager/context';
import * as newContext from '@thru/sdk/programs/wallet/context';

assert.equal(legacy.PASSKEY_MANAGER_PROGRAM_ADDRESS, current.WALLET_PROGRAM_ADDRESS);
assert.equal(PASSKEY_MANAGER_PROGRAM_ADDRESS, WALLET_PROGRAM_ADDRESS);
assert.equal(WALLET_PROGRAM_ADDRESS, 'taPASSIvjIgz2kZ1CIIhvbT00XV9Ve5kZ2I9uDLanzIgbA');
assert.equal(oldRecord.footprint(), newRecord.footprint());
assert.equal(oldRecord.footprint(), 73);
assert.equal(typeof oldContext.buildWalletAccountContext, typeof newContext.buildWalletAccountContext);
assert.equal(typeof oldContext.buildWalletAccountContext, 'function');

const require = createRequire(import.meta.url);
assert.equal(require('@thru/programs/passkey-manager').PASSKEY_MANAGER_PROGRAM_ADDRESS,
  require('@thru/programs/wallet').WALLET_PROGRAM_ADDRESS);
assert.equal(typeof require('@thru/sdk/programs/passkey-manager/context').buildWalletAccountContext, 'function');
assert.equal(require('@thru/sdk/programs/passkey-manager/abi/thru/program/passkey_manager/types').AuthorityRecord.footprint(), 73);
for (const suffix of ['abi/thru/common/primitives/types', 'abi/thru/blockchain/state_proof/types']) {
  assert.deepEqual(Object.keys(await import('@thru/sdk/programs/passkey-manager/' + suffix)),
    Object.keys(await import('@thru/sdk/programs/wallet/' + suffix)));
  assert.deepEqual(Object.keys(require('@thru/sdk/programs/passkey-manager/' + suffix)),
    Object.keys(require('@thru/sdk/programs/wallet/' + suffix)));
}
console.log('PASS: legacy/new ESM and CJS paths, constants, context, and codec exports');
