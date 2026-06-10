import {
  bytesToBase64Url,
  createValidateChallenge,
  decodeAddress,
  fetchWalletNonce,
} from '@thru/programs/passkey-manager';
import type { AccountContext } from '@thru/programs/passkey-manager';
import type { PasskeyChallengeResult, ThruClient } from './types';

export async function createPasskeyChallenge(opts: {
  client: ThruClient;
  walletAddress: string;
  accountCtx: AccountContext;
  targetProgramAddress: string;
  instructionData: Uint8Array;
  authIdx?: number;
}): Promise<PasskeyChallengeResult> {
  const nonce = await fetchWalletNonce(opts.client, opts.walletAddress);
  const targetProgramIdx = opts.accountCtx.getAccountIndex(
    decodeAddress(opts.targetProgramAddress)
  );
  const challenge = await createValidateChallenge(
    nonce,
    opts.accountCtx.accountAddresses,
    opts.accountCtx.walletAccountIdx,
    opts.authIdx ?? 0,
    {
      programIdx: targetProgramIdx,
      instructionData: opts.instructionData,
    }
  );

  return {
    challenge: bytesToBase64Url(challenge),
    nonce: nonce.toString(),
  };
}
