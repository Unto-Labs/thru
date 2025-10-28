'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/useWallet';
import { WalletManager } from '@/lib/wallet/wallet-manager';
import { SeedPhraseInput } from '@/components/wallet/SeedPhraseInput';
import { PasswordPrompt } from '@/components/wallet/PasswordPrompt';

type Step = 'seed-phrase' | 'password' | 'saving';

export default function ImportWallet() {
  const router = useRouter();
  const { importWallet } = useWallet();
  const [step, setStep] = useState<Step>('seed-phrase');
  const [mnemonic, setMnemonic] = useState('');
  const [error, setError] = useState('');

  const handleSeedPhraseSubmit = (phrase: string) => {
    setError('');

    // Validate mnemonic
    if (!WalletManager.validateMnemonic(phrase)) {
      setError('Invalid seed phrase. Please check your words and try again.');
      return;
    }

    setMnemonic(phrase);
    setStep('password');
  };

  const handlePasswordSubmit = async (password: string) => {
    setStep('saving');
    setError('');

    try {
      await importWallet(mnemonic, password);
      // Redirect to homepage (user will unlock to access /accounts)
      router.push('/');
    } catch (err) {
      console.error('Error importing wallet:', err);
      setError(err instanceof Error ? err.message : 'Failed to import wallet');
      setStep('password');
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Import Wallet</h1>
          <div className="flex items-center justify-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                step === 'seed-phrase' ? 'bg-blue-600' : 'bg-green-500'
              }`}
            />
            <div
              className={`w-3 h-3 rounded-full ${
                step === 'password' ? 'bg-blue-600' : step === 'saving' ? 'bg-green-500' : 'bg-gray-300'
              }`}
            />
          </div>
        </div>

        {step === 'seed-phrase' && (
          <SeedPhraseInput onSubmit={handleSeedPhraseSubmit} />
        )}

        {step === 'password' && (
          <PasswordPrompt
            title="Create Password"
            description="Create a password to encrypt your imported wallet."
            onSubmit={handlePasswordSubmit}
            confirmPassword
          />
        )}

        {step === 'saving' && (
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-blue-600 mb-4" />
            <p className="text-gray-600">Importing your wallet...</p>
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
