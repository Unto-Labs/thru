'use client';

import { PasswordPrompt } from '@/components/wallet/PasswordPrompt';
import { SeedPhraseDisplay } from '@/components/wallet/SeedPhraseDisplay';
import { useWallet } from '@/hooks/useWallet';
import { WalletManager } from '@/lib/wallet/wallet-manager';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Step = 'password' | 'seed-phrase' | 'saving';

export default function CreateWallet() {
  const router = useRouter();
  const { createWallet } = useWallet();
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [error, setError] = useState('');

  const handlePasswordSubmit = (pass: string) => {
    setPassword(pass);
    // Generate mnemonic
    const newMnemonic = WalletManager.generateMnemonic();
    setMnemonic(newMnemonic);
    setStep('seed-phrase');
  };

  const handleSeedPhraseConfirm = async () => {
    setStep('saving');
    setError('');

    try {
      await createWallet(password, mnemonic);
      // Redirect to homepage (user will unlock to access /accounts)
      router.push('/');
    } catch (err) {
      console.error('Error creating wallet:', err);
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
      setStep('seed-phrase');
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Create New Wallet</h1>
          <div className="flex items-center justify-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${step === 'password' ? 'bg-blue-600' : 'bg-green-500'
                }`}
            />
            <div
              className={`w-3 h-3 rounded-full ${step === 'seed-phrase' ? 'bg-blue-600' : step === 'saving' ? 'bg-green-500' : 'bg-gray-300'
                }`}
            />
          </div>
        </div>

        {step === 'password' && (
          <PasswordPrompt
            title="Create Password"
            description="This password will be used to unlock your wallet. Make sure it's strong and memorable."
            onSubmit={handlePasswordSubmit}
            confirmPassword
          />
        )}

        {step === 'seed-phrase' && (
          <SeedPhraseDisplay
            mnemonic={mnemonic}
            onConfirm={handleSeedPhraseConfirm}
          />
        )}

        {step === 'saving' && (
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-blue-600 mb-4" />
            <p className="text-gray-600">Creating your wallet...</p>
          </div>
        )}

        {error && (
          <div className="mt-6 bg-red-50 border-2 border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        <div className="mt-8 text-center">
          <a href="/" className="text-blue-600 hover:text-blue-700 text-sm">
            ← Back to home
          </a>
        </div>
      </div>
    </main>
  );
}
