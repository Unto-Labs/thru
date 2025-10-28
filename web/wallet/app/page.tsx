'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/useWallet';

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
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-blue-600" />
      </main>
    );
  }

  // Show wallet setup options if no wallet exists
  if (!walletExists) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gray-50">
        <div className="text-center max-w-md">
          <h1 className="text-4xl font-bold mb-4">Thru Wallet</h1>
          <p className="text-gray-600 mb-8">
            A secure Solana wallet for iframe integration
          </p>

          <div className="flex flex-col gap-4">
            <a
              href="/create"
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Create New Wallet
            </a>
            <a
              href="/import"
              className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
            >
              Import Wallet
            </a>
          </div>
        </div>
      </main>
    );
  }

  // Show unlock form if wallet exists but is locked
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Welcome back</h1>
          <p className="text-gray-600">Enter your password to unlock your wallet</p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-6">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              placeholder="Enter your password"
              required
              disabled={isUnlocking}
            />
          </div>

          {error && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isUnlocking || !password}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {isUnlocking ? 'Unlocking...' : 'Unlock Wallet'}
          </button>
        </form>
      </div>
    </main>
  );
}
