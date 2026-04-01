import type { PasskeyContextResult } from './types';
import { createPasskeyChallenge } from './challenge';
import { submitPasskeyTransaction } from './submit';
import type {
  PasskeyChallengeSubmitPayload,
  ThruClient,
  TransactionResult,
} from './types';

export function createPasskeyHandlers<P>(opts: {
  buildContext: (params: P) => Promise<PasskeyContextResult>;
  adminPublicKey: Uint8Array;
  adminPrivateKey: string;
  client: ThruClient;
  challengeTtlMs?: number;
}) {
  const pendingContexts = new Map<
    string,
    { context: PasskeyContextResult; createdAt: number }
  >();
  const challengeTtlMs = opts.challengeTtlMs ?? 5 * 60_000;

  function createPendingContextKey(
    walletAddress: string,
    nonce: string,
    challenge: string
  ): string {
    return `${walletAddress}:${nonce}:${challenge}`;
  }

  function prunePendingContexts(now = Date.now()): void {
    for (const [nonce, entry] of pendingContexts.entries()) {
      if (now - entry.createdAt > challengeTtlMs) {
        pendingContexts.delete(nonce);
      }
    }
  }

  return {
    challenge: async (walletAddress: string, params: P) => {
      prunePendingContexts();

      const context = await opts.buildContext(params);
      const challenge = await createPasskeyChallenge({
        client: opts.client,
        walletAddress,
        accountCtx: context.accountCtx,
        invokeIx: context.invokeIx,
      });

      pendingContexts.set(
        createPendingContextKey(walletAddress, challenge.nonce, challenge.challenge),
        {
          context,
          createdAt: Date.now(),
        }
      );

      return challenge;
    },
    submit: async (
      walletAddress: string,
      params: P,
      payload: PasskeyChallengeSubmitPayload
    ): Promise<TransactionResult> => {
      void params;
      prunePendingContexts();

      const pendingKey = createPendingContextKey(
        walletAddress,
        payload.nonce,
        payload.challenge
      );
      const pending = pendingContexts.get(pendingKey);
      if (!pending) {
        throw new Error('Missing or expired challenge nonce');
      }

      pendingContexts.delete(pendingKey);
      const { nonce: _nonce, challenge: _challenge, ...signaturePayload } = payload;

      return submitPasskeyTransaction({
        client: opts.client,
        adminPublicKey: opts.adminPublicKey,
        adminPrivateKey: opts.adminPrivateKey,
        walletAddress,
        accountCtx: pending.context.accountCtx,
        invokeIx: pending.context.invokeIx,
        ...signaturePayload,
      });
    },
  };
}
