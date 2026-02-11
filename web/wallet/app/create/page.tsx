'use client';

import { useWallet } from '@/hooks/useWallet';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Body3, Button, Card, Heading5, Input } from '@thru/design-system';

export default function CreateWallet() {
  const router = useRouter();
  const {
    isPasskeySupported,
    passkeyError,
    isRegisteringPasskey,
    isSigningWithPasskey,
    hasPasskey,
    isInitialized,
    isUnlocked,
    registerPasskey,
    signInWithPasskey,
    clearPasskeyError,
  } = useWallet();
  const [status, setStatus] = useState('');
  const [passkeyAlias, setPasskeyAlias] = useState('');
  const [aliasError, setAliasError] = useState('');

  useEffect(() => {
    if (isInitialized && isUnlocked) {
      router.push('/accounts');
    }
  }, [isInitialized, isUnlocked, router]);

  const handleRegisterPasskey = async () => {
    setStatus('');
    const trimmedAlias = passkeyAlias.trim();
    if (!trimmedAlias) {
      setAliasError('Enter a passkey name');
      return;
    }
    setAliasError('');
    const ok = await registerPasskey(trimmedAlias);
    if (ok) {
      setStatus('Passkey registered. You can log in now.');
      setPasskeyAlias('');
    }
  };

  const handlePasskeySignIn = async () => {
    clearPasskeyError();
    try {
      await signInWithPasskey();
    } catch (err) {
      console.error('Passkey sign-in error:', err);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-3xl">
        <Card variant="default" className="p-8">
          <Heading5 className="text-text-primary mb-2" bold>
            Create Passkey Profile
          </Heading5>
          <Body3 className="text-text-secondary mb-6">
            Register a passkey to unlock your wallet and create passkey-managed accounts.
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

          {aliasError && (
            <div className="bg-surface-brick border border-border-brand p-4 mb-6">
              <Body3 className="text-text-primary">{aliasError}</Body3>
            </div>
          )}

          {status && (
            <div className="bg-surface-higher border border-border-tertiary p-4 mb-6">
              <Body3 className="text-text-primary">{status}</Body3>
            </div>
          )}

          {hasPasskey ? (
            <Button
              type="button"
              disabled={!isPasskeySupported || isSigningWithPasskey}
              variant="primary"
              className="w-full"
              onClick={handlePasskeySignIn}
            >
              {isSigningWithPasskey ? 'Logging in...' : 'Log In with Passkey'}
            </Button>
          ) : (
            <>
              <div className="mb-6">
                <Body3 className="text-text-secondary mb-2">Passkey name</Body3>
                <Input
                  type="text"
                  value={passkeyAlias}
                  onChange={(event) => {
                    setPasskeyAlias(event.target.value);
                    if (aliasError) {
                      setAliasError('');
                    }
                  }}
                  placeholder="e.g. Evelyn's laptop"
                  disabled={isRegisteringPasskey}
                />
              </div>

              <Button
                type="button"
                disabled={!isPasskeySupported || isRegisteringPasskey}
                variant="primary"
                className="w-full"
                onClick={handleRegisterPasskey}
              >
                {isRegisteringPasskey ? 'Registering...' : 'Register Passkey'}
              </Button>
            </>
          )}
        </Card>

        <div className="mt-8 text-center">
          <a
            href="/"
            className="text-text-secondary hover:text-text-primary text-sm"
            onClick={() => router.push('/')}
          >
            ← Back to home
          </a>
        </div>
      </div>
    </main>
  );
}
