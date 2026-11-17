import { Pubkey, Transaction, createThruClient } from '@thru/sdk';
import { describe, expect, it } from 'vitest';
import { buildGovernedABIOperationPlan, type GovernedABIOperation } from './governance';
import { CORE_PROGRAM_ADDRESS, assertGovernancePlan, sha256, buildGovernanceTransaction, accountSlot, concat, integer } from '../core-manager';
import { buildMultisigInvokeRequest } from '../multisig';
import { BOOTSTRAP_PROGRAM_ADDRESSES, BOOTSTRAP_PROGRAM_SEEDS } from '../bootstrap-addresses';
import { AbiManagerInstruction } from './abi/thru/program/abi_manager/types';
const addr = (n: number) => Pubkey.from(new Uint8Array(32).fill(n)).toThruFmt();
const yaml = new TextEncoder().encode(`abi:
  package: test.governed
  abi-version: 1
  package-version: "1.0.0"
  description: governed fixture
  imports: []
types:
  - name: Value
    kind:
      struct:
        packed: true
        fields:
          - name: count
            field-type:
              primitive: u64
`);
const source = { address: addr(44), bytes: yaml };
const makePlan = (operation: GovernedABIOperation) => buildGovernedABIOperationPlan({ admin: addr(33), adminKind: 'multisig', operation });
describe('official Core ABI approved artifacts', () => {
  it.each([
    ['createMetadata', 0x10], ['createContent', 0x12], ['upgrade', 0x13], ['close', 0x14], ['finalize', 0x15],
  ] as const)('encodes and binds the %s path', async (kind, tag) => {
    const operation: GovernedABIOperation = kind === 'createContent' || kind === 'upgrade'
      ? { kind, seed: 'subject', ephemeral: true, source }
      : { kind, seed: 'subject', ephemeral: true };
    const approved = await makePlan(operation);
    expect(approved.instruction.length).toBe(279);
    expect(approved.instruction[0]).toBe(tag);
    const original = await buildMultisigInvokeRequest(approved);
    approved.instruction[71] ^= 1;
    await expect(assertGovernancePlan(approved)).rejects.toThrow('modified');
    expect(original.length).toBeGreaterThan(279);
  });
  it('binds exact YAML payload bytes, source address, offset and length, excluding ABI header', async () => {
    const wrapped = new Uint8Array(7 + yaml.length + 5); wrapped.set(yaml, 7);
    const approved = await makePlan({ kind: 'upgrade', seed: 'subject', source: { address: addr(44), bytes: wrapped, offset: 7, length: yaml.length } });
    expect(approved.commitments).toEqual([{ address: addr(44), offset: 7, length: yaml.length, sha256: await sha256(yaml) }]);
    expect(new DataView(approved.instruction.buffer).getUint32(239, true)).toBe(7);
    expect(new DataView(approved.instruction.buffer).getUint32(243, true)).toBe(yaml.length);
    const altered = await makePlan({ kind: 'upgrade', seed: 'subject', source: { address: addr(44), bytes: new TextEncoder().encode(new TextDecoder().decode(yaml).replace('count', 'value')) } });
    expect(altered.commitments[0].sha256).not.toBe(approved.commitments[0].sha256);
    const moved = await makePlan({ kind: 'upgrade', seed: 'subject', source: { ...source, address: addr(45) } });
    expect(moved.planSha256).not.toBe(approved.planSha256);
  });
  it('restricts root correction to its dedicated upgrade-only encoding with absent program metadata', async () => {
    const approved = await makePlan({ kind: 'upgradeRoot', source });
    expect(approved.instruction[0]).toBe(0x0e);
    expect(approved.instruction.subarray(71, 103)).toEqual(Pubkey.from(CORE_PROGRAM_ADDRESS).toBytes());
    expect(approved.instruction.subarray(103, 137)).toEqual(new Uint8Array(34));
    expect(approved.commitments[0].sha256).toBe(await sha256(yaml));
  });
  it.each(['eoa', 'multisig'] as const)('serializes every official Multicall ABI operation without executing Multicall (%s)', async adminKind => {
    const client = createThruClient(), privateKey = new Uint8Array(32).fill(71), publicKey = await client.keys.fromPrivateKey(privateKey);
    const proof = new Uint8Array(104); new DataView(proof.buffer).setBigUint64(0, 2n << 62n, true);
    for (const kind of ['createMetadata', 'createContent', 'upgrade', 'close', 'finalize'] as const) {
      const operation: GovernedABIOperation = kind === 'createContent' || kind === 'upgrade'
        ? { kind, seed: BOOTSTRAP_PROGRAM_SEEDS.multicall, source, ...(kind === 'createContent' ? { proof } : {}) }
        : { kind, seed: BOOTSTRAP_PROGRAM_SEEDS.multicall, ...(kind === 'createMetadata' ? { proof } : {}) };
      const approved = await buildGovernedABIOperationPlan({ admin: adminKind === 'eoa' ? publicKey : addr(33), adminKind, multisigRequest: adminKind === 'multisig' ? addr(34) : undefined, operation });
      const wrapper = adminKind === 'eoa' ? BOOTSTRAP_PROGRAM_ADDRESSES.abi_manager : BOOTSTRAP_PROGRAM_ADDRESSES.multisig;
      expect(approved.accounts.readOnly).toContain(BOOTSTRAP_PROGRAM_ADDRESSES.multicall);
      expect(accountSlot(approved.accounts, wrapper)).toBe(1);
      expect(approved.instruction.subarray(71, 103)).toEqual(Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.multicall).toBytes());
      expect(AbiManagerInstruction.validate(approved.instruction).ok).toBe(true);
      const instruction = adminKind === 'eoa' ? approved.instruction : concat(integer(3, 4), integer(accountSlot(approved.accounts, addr(33)), 2), integer(accountSlot(approved.accounts, addr(34)), 2));
      const tx = await buildGovernanceTransaction(approved, publicKey, [{ program: wrapper, instruction }]);
      const signed = await client.transactions.buildAndSign({ ...tx, feePayer: { publicKey, privateKey }, header: { fee: 0n, nonce: 0n, startSlot: 10n, chainId: 1 } });
      const decoded = Transaction.fromWire(signed.rawTransaction);
      expect(tx.program).toBe(wrapper);
      expect(decoded.instructionData).toEqual(instruction);
      expect(decoded.readOnlyAccounts.map(p => p.toThruFmt())).toEqual(approved.accounts.readOnly);
      if (adminKind === 'multisig') expect((await buildMultisigInvokeRequest(approved)).subarray(-approved.instruction.length)).toEqual(approved.instruction);
    }
  });
  it('rejects malformed YAML before approval and oversized permanent-create requests', async () => {
    await expect(makePlan({ kind: 'upgrade', seed: 'subject', source: { address: addr(44), bytes: Uint8Array.of(255) } })).rejects.toThrow();
    const proof = new Uint8Array(8296); new DataView(proof.buffer).setBigUint64(0, 2n << 62n, true); proof.fill(255, 8, 40);
    const approved = await makePlan({ kind: 'createContent', seed: 'subject', source, proof });
    await expect(buildMultisigInvokeRequest(approved)).rejects.toThrow('4096');
  });
});
