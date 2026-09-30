import { decodeAddress, decodeBase64 } from '@thru/sdk/helpers';
import { PASSKEY_MANAGER_PROGRAM_ADDRESS } from '../../../src/core-program-addresses';
import type { ThruClientContext } from '../../core/client';
import { Transaction } from '../../domain/transactions/Transaction';
import { Pubkey } from '../../domain/primitives';
import { buildWalletAccountContext, assertWalletFeePayerCompatible } from '../../domain/programs/passkey-manager/context';
import { PasskeyInstruction, ValidateArgs } from '../../domain/programs/passkey-manager/abi/thru/program/passkey_manager/types';
import { bytesEqual } from '../../domain/programs/helpers/bytes';
import { getChainId } from '../chain';
import { CompressionError, type CompressionTransaction, type WalletCompressionOptions } from './types';

function intentContext(request: CompressionTransaction, options: WalletCompressionOptions) {
  const programAddress = options.programAddresses?.passkeyManager ?? PASSKEY_MANAGER_PROGRAM_ADDRESS;
  const params = { walletAddress: options.walletAddress, programAddress,
    readWriteAccounts: request.readWrite.map(decodeAddress),
    readOnlyAccounts: [request.program, ...(request.readOnly ?? [])].map(decodeAddress) };
  assertWalletFeePayerCompatible({ ...params, feePayerAddress: Pubkey.from(options.feePayer.publicKey).toThruFmt() });
  return { ...buildWalletAccountContext(params), programAddress };
}

async function instruction(request: CompressionTransaction, options: WalletCompressionOptions) {
  const context = intentContext(request, options);
  const bytes = await request.instructionData({
    getAccountIndex: address => context.getAccountIndex(decodeAddress(address)),
    // Uploaded wallet restores use account pointers; no absolute transaction pointer is encoded.
    instructionDataOffset: 0,
  });
  return { context, bytes };
}

export async function measureWalletRequest(request: CompressionTransaction, options: WalletCompressionOptions): Promise<number> {
  const { context, bytes } = await instruction(request, options);
  // Reserve space for passkey authentication data. The actual signed envelope is
  // checked again before submission, including authenticators with larger data.
  return 112 + 64 + 32 * (context.readWriteAddresses.length + context.readOnlyAddresses.length) + bytes.length + 1536;
}

export async function signWalletRequest(ctx: ThruClientContext, request: CompressionTransaction,
  options: WalletCompressionOptions, nonce: bigint): Promise<Uint8Array> {
  if (request.flags) throw new Error('Wallet intents cannot set compression transaction flags');
  const { context, bytes } = await instruction(request, options);
  const chainId = await getChainId(ctx);
  const signedBase64 = await options.signTransaction({
    walletAddress: options.walletAddress, programAddress: request.program,
    instructionData: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')),
    stateUnits: request.stateUnits,
    readWriteAddresses: context.readWriteAddresses, readOnlyAddresses: context.readOnlyAddresses,
  });
  const signed = decodeBase64(signedBase64);
  if (signed.length > (options.maxTransactionBytes ?? 32768))
    throw new CompressionError('TRANSACTION_TOO_LARGE', 'Signed wallet prerequisite exceeds the transaction wire limit');
  const tx = Transaction.fromWire(signed);
  const equalAddresses = (actual: Pubkey[], expected: string[]) =>
    actual.length === expected.length && actual.every((key, index) => key.toThruFmt() === expected[index]);
  const payload = tx.instructionData ?? new Uint8Array();
  const wrapper = PasskeyInstruction.validate(payload);
  const argsValidation = ValidateArgs.validate(payload.subarray(1));
  const args = argsValidation.ok ? ValidateArgs.from_array(payload.subarray(1)) : null;
  const target = args?.get_target_instruction();
  if (tx.feePayer.toThruFmt() !== Pubkey.from(options.feePayer.publicKey).toThruFmt() ||
      tx.program.toThruFmt() !== context.programAddress || tx.nonce !== nonce || tx.chainId !== chainId ||
      tx.fee !== 0n || tx.flags !== 0 || tx.requestedStateUnits < request.stateUnits ||
      !equalAddresses(tx.readWriteAccounts, context.readWriteAddresses) ||
      !equalAddresses(tx.readOnlyAccounts, context.readOnlyAddresses) ||
      payload[0] !== 1 || !wrapper.ok || wrapper.consumed !== payload.length ||
      !args || argsValidation.consumed !== payload.length - 1 ||
      args.get_wallet_account_idx() !== context.walletAccountIdx ||
      target?.get_program_idx() !== context.getAccountIndex(decodeAddress(request.program)) ||
      !bytesEqual(Uint8Array.from(target.get_data()), bytes)) {
    throw new Error('Wallet changed prerequisite payload, account layout or fee payer; refresh signing context before retrying');
  }
  return signed;
}
