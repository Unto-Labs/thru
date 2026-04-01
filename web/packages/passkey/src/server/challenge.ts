import {
  bytesToBase64Url,
  createValidateChallenge,
  fetchWalletNonce,
} from '@thru/passkey-manager';
import type { AccountContext } from '@thru/passkey-manager';
import type { PasskeyChallengeResult, ThruClient } from './types';

export async function createPasskeyChallenge(opts: {
  client: ThruClient;
  walletAddress: string;
  accountCtx: AccountContext;
  invokeIx: Uint8Array;
}): Promise<PasskeyChallengeResult> {
  const nonce = await fetchWalletNonce(opts.client, opts.walletAddress);
  const challenge = await createValidateChallenge(
    nonce,
    opts.accountCtx.accountAddresses,
    opts.invokeIx
  );

  return {
    challenge: bytesToBase64Url(challenge),
    nonce: nonce.toString(),
  };
}
