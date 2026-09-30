import { decodeAddress } from '@thru/sdk/helpers';
import { COMPRESSION_PROGRAM_ADDRESS, MULTICALL_PROGRAM_ADDRESS, UPLOADER_PROGRAM_ADDRESS } from '../../../src/core-program-addresses';
import { buildCompressInstruction, buildDecompressInstruction, buildDecompressFromPointerInstruction, validateCompressionProof } from '../../domain/programs/compression/instructions';
import { buildMulticallInstruction } from '../../domain/programs/multicall';
import { buildUploaderInstructionBytes } from '../../domain/programs/uploader/instructions';
import { deriveUploadAddresses } from '../../domain/programs/uploader/derivation';
import type { AccountImage, Instruction, UploadPair } from './types';
function u16(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError('account index must be a u16');
}
function dataPointer(index: number, offset: number): bigint {
  u16(index);
  if (!Number.isInteger(offset) || offset < 0 || offset >= 1 << 24) throw new RangeError("invalid VM data offset");
  return (3n << 40n) | (BigInt(index) << 24n) | BigInt(offset);
}

/** Concrete instruction composition for the built-in compression workflows. */
export function compressionInstructions(config: {
  compression?: string; multicall?: string; uploader?: string;
}) {
  const addresses = { compression: config.compression ?? COMPRESSION_PROGRAM_ADDRESS,
    multicall: config.multicall ?? MULTICALL_PROGRAM_ADDRESS,
    uploader: config.uploader ?? UPLOADER_PROGRAM_ADDRESS };
  for (const address of Object.values(addresses)) decodeAddress(address);
  return {
    ...addresses,
    compress: (address: string, proof: Uint8Array): Instruction => ctx => buildCompressInstruction(ctx.getAccountIndex(address), proof),
    decompress: (address: string, image: AccountImage, proof: Uint8Array): Instruction => ctx => buildDecompressInstruction(ctx.getAccountIndex(address), image.meta, image.data, proof),
    decompressUploaded: (address: string, image: AccountImage, metaBuffer: string, dataBuffer: string, dataOffset: number, proof: Uint8Array, proofBuffer?: string): Instruction => ctx => {
      validateCompressionProof(proof);
      const prefix = buildDecompressFromPointerInstruction({ accountIndex: ctx.getAccountIndex(address),
        dataSize: BigInt(image.data.length), metaAddress: dataPointer(ctx.getAccountIndex(metaBuffer), 2),
        dataAddress: dataPointer(ctx.getAccountIndex(dataBuffer), dataOffset),
        proofAddress: proofBuffer ? dataPointer(ctx.getAccountIndex(proofBuffer), 0) : (1n << 24n) + BigInt(ctx.instructionDataOffset + 46), proofSize: BigInt(proof.length) });
      if (proofBuffer) return prefix;
      const bytes = new Uint8Array(prefix.length + proof.length);
      bytes.set(prefix); bytes.set(proof, prefix.length);
      return bytes;
    },
    batch: (calls: Instruction[]): Instruction => async ctx => buildMulticallInstruction(await Promise.all(calls.map(async call => ({
      programIdx: ctx.getAccountIndex(addresses.compression), instructionData: await call(ctx),
    })))),
    deriveUpload: (seed: Uint8Array) => {
      const pair = deriveUploadAddresses(seed, addresses.uploader);
      return { meta: pair.metaAccountAddress, buffer: pair.bufferAccountAddress };
    },
    createUpload: (pair: UploadPair, authority: string, seed: Uint8Array, size: number, hash: Uint8Array): Instruction => ctx => buildUploaderInstructionBytes({ kind: "create",
      bufferAccountIdx: ctx.getAccountIndex(pair.buffer), metaAccountIdx: ctx.getAccountIndex(pair.meta),
      authorityAccountIdx: ctx.getAccountIndex(authority), seed, bufferSize: size, expectedHash: hash }),
    writeUpload: (pair: UploadPair, offset: number, data: Uint8Array): Instruction => ctx => buildUploaderInstructionBytes({ kind: "write",
      bufferAccountIdx: ctx.getAccountIndex(pair.buffer), metaAccountIdx: ctx.getAccountIndex(pair.meta), offset, data }),
    destroyUpload: (pair: UploadPair): Instruction => ctx => buildUploaderInstructionBytes({ kind: "destroy",
      bufferAccountIdx: ctx.getAccountIndex(pair.buffer), metaAccountIdx: ctx.getAccountIndex(pair.meta) }),
  };
}
