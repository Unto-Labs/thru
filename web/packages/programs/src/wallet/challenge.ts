import type { TargetInstructionParams } from './types';
import { buildTargetInstructionBytes } from './target-instruction';

/**
 * Create challenge for VALIDATE instruction.
 * SHA256(domain || nonce || wallet_account_idx || auth_idx || account_count ||
 *        account_0 || account_1 || ... || target_instruction)
 */
export const VALIDATE_CHALLENGE_DOMAIN = 'thru.passkey.validate';

function writeU64LE(target: Uint8Array, offset: number, value: bigint): void {
  let remaining = value;
  for (let i = 0; i < 8; i++) {
    target[offset + i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

export async function createValidateChallenge(
  nonce: bigint,
  accountAddresses: string[],
  walletAccountIdx: number,
  authIdx: number,
  targetInstruction: TargetInstructionParams
): Promise<Uint8Array> {
  const targetInstructionBytes = buildTargetInstructionBytes(targetInstruction);
  const encoder = new TextEncoder();
  const domainBytes = encoder.encode(VALIDATE_CHALLENGE_DOMAIN);
  const accountBytes = accountAddresses.map((address) => {
    const bytes = encoder.encode(address);
    if (bytes.length !== 46) {
      throw new Error('accountAddresses must contain ta addresses');
    }
    return bytes;
  });
  if (walletAccountIdx < 0 || walletAccountIdx > 0xffff) {
    throw new Error('walletAccountIdx must be 0-65535');
  }
  if (authIdx < 0 || authIdx > 0xff) throw new Error('authIdx must be 0-255');
  if (accountBytes.length > 0xffff) throw new Error('accountAddresses length must be 0-65535');

  const totalSize =
    domainBytes.length +
    8 +
    2 +
    1 +
    2 +
    accountBytes.reduce((sum, bytes) => sum + bytes.length, 0) +
    targetInstructionBytes.length;
  const challengeData = new Uint8Array(totalSize);

  let offset = 0;
  challengeData.set(domainBytes, offset);
  offset += domainBytes.length;

  writeU64LE(challengeData, offset, nonce);
  offset += 8;

  challengeData[offset] = walletAccountIdx & 0xff;
  challengeData[offset + 1] = (walletAccountIdx >> 8) & 0xff;
  offset += 2;

  challengeData[offset] = authIdx & 0xff;
  offset += 1;

  challengeData[offset] = accountBytes.length & 0xff;
  challengeData[offset + 1] = (accountBytes.length >> 8) & 0xff;
  offset += 2;

  for (const bytes of accountBytes) {
    challengeData.set(bytes, offset);
    offset += bytes.length;
  }

  challengeData.set(targetInstructionBytes, offset);

  const hashBuffer = await crypto.subtle.digest('SHA-256', challengeData);
  return new Uint8Array(hashBuffer);
}
