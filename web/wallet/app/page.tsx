'use client';

import { useWallet } from '@/hooks/useWallet';
import { Body3, Button, Card, Input } from '@thru/design-system';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Home() {
  const router = useRouter();
  const { walletExists, isUnlocked, unlockWallet, isInitialized } = useWallet();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);

  // Redirect to accounts if already unlocked
  useEffect(() => {
    if (isInitialized && isUnlocked) {
      router.push('/accounts');
    }
  }, [isInitialized, isUnlocked, router]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsUnlocking(true);

    try {
      await unlockWallet(password);
      // Navigation handled by useEffect above
    } catch (err) {
      console.error('Unlock error:', err);
      setError('Incorrect password');
      setPassword('');
    } finally {
      setIsUnlocking(false);
    }
  };

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-higher">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-border-tertiary border-t-border-brand" />
      </main>
    );
  }

  // Show wallet setup options if no wallet exists
  if (!walletExists) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-surface-higher">
        <div className="text-center max-w-md">
          <div className="flex items-center justify-center mb-5">
            <img 
              src="/logo/logo-wordmark_solid_red.svg" 
              alt="Thru" 
              className="h-15"
            />
          </div>

          <div className="flex flex-col gap-4">
            <Link href="/create" className="w-full">
              <Button variant="primary" className="w-full">
                Create New Wallet
              </Button>
            </Link>
            <Link href="/import" className="w-full">
              <Button variant="outline" className="w-full">
                Import Wallet
              </Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Show unlock form if wallet exists but is locked
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-surface-higher">
      <div className="w-full max-w-md">
        <Card variant="default" className="p-8">
          <div className="text-center flex flex-col items-center mb-8">
            <img src="/logo/logo-wordmark_solid_red.svg" alt="Thru" className="h-13" />
          </div>

          <form onSubmit={handleUnlock} className="space-y-6">
            <Input
              type="password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              disabled={isUnlocking}
              error={!!error}
            />

            {error && (
              <div className="bg-surface-brick border border-border-brand p-4">
                <Body3 className="text-text-primary">{error}</Body3>
              </div>
            )}

            <Button
              type="submit"
              disabled={isUnlocking || !password}
              variant="primary"
              className="w-full"
            >
              {isUnlocking ? 'Unlocking...' : 'Unlock Wallet'}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
