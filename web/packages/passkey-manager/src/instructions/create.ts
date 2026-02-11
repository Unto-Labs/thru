import type { Authority, CreateInstructionParams } from '../types';
import {
  AuthorityBuilder,
  CreateArgsBuilder,
  PasskeyInstructionBuilder,
} from '../abi/thru/program/passkey_manager/types';

function buildAuthority(authority: Authority): Uint8Array {
  const data = new Array<number>(64).fill(0);

  if (authority.tag === 1) {
    if (authority.pubkeyX.length !== 32) throw new Error('pubkeyX must be 32 bytes');
    if (authority.pubkeyY.length !== 32) throw new Error('pubkeyY must be 32 bytes');
    for (let i = 0; i < 32; i++) data[i] = authority.pubkeyX[i];
    for (let i = 0; i < 32; i++) data[32 + i] = authority.pubkeyY[i];
  } else if (authority.tag === 2) {
    if (authority.pubkey.length !== 32) throw new Error('pubkey must be 32 bytes');
    for (let i = 0; i < 32; i++) data[i] = authority.pubkey[i];
  } else {
    throw new Error('Invalid authority tag');
  }

  return new AuthorityBuilder()
    .set_tag(authority.tag)
    .set_data(data)
    .build();
}

export { buildAuthority };

export function encodeCreateInstruction(params: CreateInstructionParams): Uint8Array {
  const { walletAccountIdx, authority, seed, stateProof } = params;

  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }

  const authorityBytes = buildAuthority(authority);

  const argsPayload = new CreateArgsBuilder()
    .set_wallet_account_idx(walletAccountIdx)
    .set_authority(authorityBytes)
    .set_seed(seed)
    .set_state_proof(stateProof)
    .build();

  return new PasskeyInstructionBuilder()
    .payload()
    .select('create')
    .writePayload(argsPayload)
    .finish()
    .build();
}
