'use client';

import { useWallet } from '@/hooks/useWallet';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Body3, Button, Card, Heading5 } from '@thru/design-system';

export default function SignIn() {
  const router = useRouter();
  const {
    isPasskeySupported,
    passkeyError,
    isSigningWithPasskey,
    signInWithPasskey,
  } = useWallet();
  const [status, setStatus] = useState('');

  const handlePasskeySignIn = async () => {
    setStatus('');
    const ok = await signInWithPasskey();
    if (ok) {
      setStatus('Signed in. Redirecting...');
      router.push('/accounts');
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-3xl">
        <Card variant="default" className="p-8">
          <Heading5 className="text-text-primary mb-2" bold>
            Sign In with Passkey
          </Heading5>
          <Body3 className="text-text-secondary mb-6">
            Use your registered passkey to unlock this wallet profile.
          </Body3>

          {!isPasskeySupported && (
            <div className="bg-surface-brick border border-border-brand p-4 mb-6">
              <Body3 className="text-text-primary">
                Passkeys are not supported in this browser.
              </Body3>
            </div>
          )}

          {passkeyError && (
            <div className="bg-surface-brick border border-border-brand p-4 mb-6">
              <Body3 className="text-text-primary">{passkeyError}</Body3>
            </div>
          )}

          {status && (
            <div className="bg-surface-higher border border-border-tertiary p-4 mb-6">
              <Body3 className="text-text-primary">{status}</Body3>
            </div>
          )}

          <Button
            type="button"
            disabled={!isPasskeySupported || isSigningWithPasskey}
            variant="primary"
            className="w-full"
            onClick={handlePasskeySignIn}
          >
            {isSigningWithPasskey ? 'Signing in...' : 'Sign In with Passkey'}
          </Button>
        </Card>

        <div className="mt-8 text-center">
          <a href="/" className="text-text-secondary hover:text-text-primary text-sm">
            ← Back to home
          </a>
        </div>
      </div>
    </main>
  );
}
