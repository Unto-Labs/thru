import { CreateArgs, WriteArgs } from '../../../domain/programs/uploader/abi/thru/program/uploader/types';
import { DecompressFromPointerArgs } from '../../../domain/programs/compression/abi/thru/program/compression/types';
import { validateCompressionProof } from '../../../domain/programs/compression/instructions';
import { createRouterTransport, Code, ConnectError } from '@connectrpc/connect';
import { expect, vi } from 'vitest';
import { QueryService, CommandService, TransactionVmError } from '@thru/sdk/proto';
import { createThruClient } from '../../../client';
import { Pubkey, Signature } from '../../../domain/primitives';
import { Transaction } from '../../../domain/transactions/Transaction';
import { fromPrivateKey } from '../../keys';
import { COMPRESSION_PROGRAM_ADDRESS, MULTICALL_PROGRAM_ADDRESS, UPLOADER_PROGRAM_ADDRESS, PASSKEY_MANAGER_PROGRAM_ADDRESS } from '../../../../src/core-program-addresses';
import { MulticallArgs } from '../../../domain/programs/multicall/abi/thru/program/multicall/types';
import { ValidateArgs, ValidateArgsBuilder, PasskeyInstructionBuilder } from '../../../domain/programs/passkey-manager/abi/thru/program/passkey_manager/types';
import { InstructionDataBuilder } from '../../../domain/programs/passkey-manager/abi/thru/common/primitives/types';
import { buildWalletAccountContext } from '../../../domain/programs/passkey-manager/context';
import type { PendingCompressionTransaction } from '../types';
import type { ThruTransactionIntent } from '../../../domain/transactions/intent';

export const address = (id: number) => Pubkey.from(new Uint8Array(32).fill(id)).toThruFmt();
export const missing = () => new ConnectError('not found', Code.NotFound);
export async function fixture(sizes: Record<string, number> = { [address(10)]: 10, [address(11)]: 20 }) {
  const seed = new Uint8Array(32).fill(7);
  const publicKey = Pubkey.from(await fromPrivateKey(seed)).toThruFmt();
  const feePayer = { publicKey, privateKey: seed };
  const images = new Map<string, { rawMeta: Uint8Array; rawData: Uint8Array; versionContext: { slot: bigint } }>();
  const active = new Set<string>();
  const buffers = new Map<string, Uint8Array>();
  const slots = { finalized: 500n, locallyExecuted: 500n, clusterExecuted: 500n };
  const chain = { nonce: 0n, confirm: true, vmError: 0, durable: undefined as bigint | undefined, sendThrows: false };
  let saved: PendingCompressionTransaction | undefined;
  const statuses = new Map<string, { vmError: number; userErrorCode: bigint }>();
  const sent: Transaction[] = [];
  const actions: string[] = [];
  let beforeExecution: ((kind: string, tx: Transaction) => void) | undefined;
  const programs = { compression: COMPRESSION_PROGRAM_ADDRESS, multicall: MULTICALL_PROGRAM_ADDRESS, uploader: UPLOADER_PROGRAM_ADDRESS };
  for (const [key, size] of Object.entries(sizes)) {
    const meta = new Uint8Array(64); new DataView(meta.buffer).setUint32(4, size, true);
    images.set(key, { rawMeta: meta, rawData: new Uint8Array(size).fill(0x5a), versionContext: { slot: 100n } });
  }
  const proof = (kind: number) => {
    const type = kind === 1 ? 2 : kind === 2 ? 1 : 0;
    const bytes = new Uint8Array(40 + type * 32);
    new DataView(bytes.buffer).setBigUint64(0, (BigInt(type) << 62n) | slots.finalized, true);
    return { proof: bytes, slot: slots.finalized };
  };
  function execute(program: string, bytes: Uint8Array, tx: Transaction): void {
    const keys = [tx.feePayer, tx.program, ...tx.readWriteAccounts, ...tx.readOnlyAccounts].map(key => key.toThruFmt());
    if (program === PASSKEY_MANAGER_PROGRAM_ADDRESS) {
      const target = ValidateArgs.from_array(bytes.subarray(1))!.get_target_instruction();
      execute(keys[target.get_program_idx()]!, Uint8Array.from(target.get_data()), tx); return;
    }
    if (program === programs.multicall) {
      actions.push('batch'); beforeExecution?.('batch', tx);
      const calls = MulticallArgs.from_array(bytes)!;
      for (const call of calls.get_calls()) execute(keys[call.get_program_idx()]!, Uint8Array.from(call.get_data()), tx);
      return;
    }
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (program === programs.compression) {
      const tag = v.getUint32(0, true); const target = keys[v.getUint16(4, true)]!;
      const kind = tag === 1 ? 'compress' : tag === 2 ? 'restore' : 'restore-upload';
      actions.push(kind); beforeExecution?.(kind, tx);
      if (tag === 4) {
        const args = DecompressFromPointerArgs.from_array(bytes.subarray(4, 46))!;
        const pointerBytes = (pointer: bigint, size: number) => {
          if (pointer >> 40n === 3n) {
            const key = keys[Number((pointer >> 24n) & 0xffffn)]!;
            const offset = Number(pointer & 0xffffffn);
            expect(buffers.has(key)).toBe(true);
            return buffers.get(key)!.subarray(offset, offset + size);
          }
          const offset = Number(pointer - (1n << 24n));
          return tx.toWire().subarray(offset, offset + size);
        };
        const image = images.get(target)!;
        expect(Buffer.from(pointerBytes(args.get_account_meta_address(), 62)).equals(Buffer.from(image.rawMeta.subarray(2))), 'uploaded metadata bytes').toBe(true);
        expect(Buffer.from(pointerBytes(args.get_account_data_address(), Number(args.get_account_data_sz()))).equals(Buffer.from(image.rawData)), 'uploaded account bytes').toBe(true);
        const proofBytes = pointerBytes(args.get_proof_address(), Number(args.get_proof_sz()));
        validateCompressionProof(proofBytes);
        expect(proofBytes[7]! >>> 6).toBe(0);
      }
      if (tag === 1) active.delete(target); else active.add(target);
      return;
    }
    if (program === programs.uploader) {
      const tag = bytes[0]; const kind = tag === 0 ? 'create' : tag === 1 ? 'write' : 'destroy';
      actions.push(kind); beforeExecution?.(kind, tx);
      const buffer = keys[v.getUint16(4, true)]!; const meta = keys[v.getUint16(6, true)]!;
      if (kind === 'create') {
        const args = CreateArgs.from_array(bytes.subarray(4))!;
        const wallet = tx.program.toThruFmt() === PASSKEY_MANAGER_PROGRAM_ADDRESS;
        expect(keys[args.get_authority_account_idx()]).toBe(wallet ? address(20) : publicKey);
        buffers.set(buffer, new Uint8Array(args.get_buffer_account_sz()));
        active.add(buffer); active.add(meta);
      }
      if (kind === 'write') {
        const args = WriteArgs.from_array(bytes.subarray(4))!;
        buffers.get(buffer)!.set(args.get_data(), args.get_data_offset());
      }
      if (kind === 'destroy') { buffers.delete(buffer); active.delete(buffer); active.delete(meta); }
    }
  }
  const getRawAccount = vi.fn(async (req: any) => {
    const key = Pubkey.from(req.address.value).toThruFmt();
    if (req.versionContext?.version.case === 'current' && !active.has(key)) throw missing();
    const image = images.get(key);
    if (!image && !active.has(key)) throw missing();
    return image ?? { rawMeta: new Uint8Array(64), rawData: new Uint8Array() };
  });
  const getAccount = vi.fn(async (req: any) => ({ address: req.address, meta: { nonce: chain.nonce, balance: 10000n } }));
  const generateStateProof = vi.fn(async (req: any) => ({ proof: proof(req.request.proofType) }));
  const batchGenerateStateProofs = vi.fn(async (req: any) => ({ results: req.requests.map((r: any) => ({ proof: proof(r.proofType) })) }));
  const getTransactionStatus = vi.fn(async (req: any) => {
    const result = statuses.get(Signature.from(req.signature.value).toThruFmt());
    if (!result) throw missing();
    return { signature: req.signature, executionResult: result };
  });
  const sendTransaction = vi.fn(async (req: any) => {
    const tx = Transaction.fromWire(req.rawTransaction); sent.push(tx);
    const signature = { value: req.rawTransaction.slice(-64) };
    if (chain.confirm) {
      const result = { vmError: chain.vmError, userErrorCode: 0n };
      try { if (!result.vmError) execute(tx.program.toThruFmt(), tx.instructionData!, tx); }
      catch { result.vmError = 12; }
      if (result.vmError !== TransactionVmError.TRANSACTION_VM_ERROR_EXPIRED) chain.nonce++;
      statuses.set(Signature.from(signature.value).toThruFmt(), result);
    }
    if (chain.sendThrows) throw new ConnectError('response lost', Code.Unavailable);
    return { signature };
  });
  const transport = createRouterTransport(router => {
    router.service(QueryService, { getRawAccount, getAccount, generateStateProof, batchGenerateStateProofs,
      getHeight: async () => slots, getChainInfo: async () => ({ chainId: 1 }),
      getStateRoots: async () => ({ stateRoots: [{ slot: chain.durable ?? slots.finalized }] }), getTransactionStatus });
    router.service(CommandService, { sendTransaction });
  });
  const make = () => createThruClient({ baseUrl: 'http://test.invalid', transport });
  const sdk = make();
  const journal = { load: vi.fn(async () => saved), save: vi.fn(async (value?: PendingCompressionTransaction) => { saved = value; }) };
  const options = { feePayer, fee: 0n, timeoutMs: 30, pollIntervalMs: 1, journal };
  const walletAddress = address(20);
  const signTransaction = vi.fn(async (intent: ThruTransactionIntent) => {
    const context = buildWalletAccountContext({ walletAddress, readWriteAccounts: (intent.readWriteAddresses ?? []).map(key => Pubkey.from(key).toBytes()),
      readOnlyAccounts: (intent.readOnlyAddresses ?? []).map(key => Pubkey.from(key).toBytes()) });
    const target = new InstructionDataBuilder().set_program_idx(context.getAccountIndex(Pubkey.from(intent.programAddress).toBytes()));
    target.data().write(Uint8Array.from(atob(intent.instructionData), c => c.charCodeAt(0))).finish();
    const args = new ValidateArgsBuilder().set_wallet_account_idx(context.walletAccountIdx).set_auth_idx(0)
      .set_signature_r(new Uint8Array(32)).set_signature_s(new Uint8Array(32)).set_target_instruction(target.build());
    args.authenticator_data().write(new Uint8Array(37)).finish(); args.client_data().write(new Uint8Array(150)).finish();
    const wrapper = new PasskeyInstructionBuilder().payload().select('validate').writePayload(args).finish().build();
    const result = await sdk.transactions.buildAndSign({ feePayer, program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
      accounts: { readWrite: context.readWriteAddresses, readOnly: context.readOnlyAddresses },
      header: { fee: 0n, stateUnits: intent.stateUnits }, instructionData: wrapper });
    return Buffer.from(result.rawTransaction).toString('base64');
  });
  return { sdk, make, options, journal, saved: () => saved, seed, publicKey, images, active, slots, chain, sent, actions, programs,
    sendTransaction, getRawAccount, getAccount, generateStateProof, batchGenerateStateProofs, getTransactionStatus, statuses,
    onExecute: (hook: typeof beforeExecution) => { beforeExecution = hook; },
    wallet: { ...options, feePayer: { publicKey }, walletAddress, signTransaction },
    indexPending: () => { statuses.set(saved!.signature, { vmError: 0, userErrorCode: 0n }); },
  };
}
