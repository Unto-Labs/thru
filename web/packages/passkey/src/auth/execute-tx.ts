import { base64UrlToBytes, bytesToBase64, bytesToHex } from '@thru/passkey-manager';
import { signWithPasskey } from '../mobile/passkey';
import { touchPasskeyLastUsedAt } from '../mobile/storage';

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`Non-JSON response (HTTP ${response.status})`);
  }
}

export async function executePasskeyTransaction<
  P extends Record<string, unknown>,
  R
>(opts: {
  challengeUrl: string;
  submitUrl: string;
  params: P;
  credentialId: string;
  rpId: string;
}): Promise<R> {
  let challengeRes: Response;
  try {
    challengeRes = await fetch(opts.challengeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.params),
    });
  } catch {
    throw new Error('Network request failed (challenge)');
  }

  const challengeData = await readJson(challengeRes);
  if (!challengeRes.ok || challengeData.success !== true) {
    throw new Error(
      typeof challengeData.error === 'string'
        ? challengeData.error
        : 'Failed to get challenge'
    );
  }

  if (typeof challengeData.challenge !== 'string') {
    throw new Error('Challenge response did not include a challenge');
  }

  const challengeBytes = base64UrlToBytes(challengeData.challenge);
  const signature = await signWithPasskey(
    opts.credentialId,
    challengeBytes,
    opts.rpId
  );
  await touchPasskeyLastUsedAt().catch((error) => {
    console.warn('Failed to update passkey last-used timestamp:', error);
  });

  const { success: _success, error: _error, ...challengeFields } = challengeData;

  let submitRes: Response;
  try {
    submitRes = await fetch(opts.submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...opts.params,
        ...challengeFields,
        signatureR: bytesToHex(signature.signatureR),
        signatureS: bytesToHex(signature.signatureS),
        authenticatorData: bytesToBase64(signature.authenticatorData),
        clientDataJSON: bytesToBase64(signature.clientDataJSON),
      }),
    });
  } catch {
    throw new Error('Network request failed (submit)');
  }

  const submitData = await readJson(submitRes);
  if (!submitRes.ok || submitData.success !== true) {
    throw new Error(
      typeof submitData.error === 'string'
        ? submitData.error
        : 'Failed to submit transaction'
    );
  }

  return submitData as R;
}
