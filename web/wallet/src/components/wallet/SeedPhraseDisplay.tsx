'use client';

import { useState } from 'react';

interface SeedPhraseDisplayProps {
  mnemonic: string;
  onConfirm: () => void;
}

export function SeedPhraseDisplay({ mnemonic, onConfirm }: SeedPhraseDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const words = mnemonic.split(' ');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleConfirm = () => {
    if (confirmed) {
      onConfirm();
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-yellow-900 mb-2">
          ⚠️ Save Your Seed Phrase
        </h3>
        <p className="text-yellow-800 text-sm">
          Write down these 12 words in order and store them securely. You'll need them to
          recover your wallet. Never share them with anyone.
        </p>
      </div>

      <div className="bg-white border-2 border-gray-200 rounded-lg p-6 mb-6">
        <div className="grid grid-cols-3 gap-4">
          {words.map((word, index) => (
            <div
              key={index}
              className="bg-gray-50 rounded-lg p-3 border border-gray-300"
            >
              <span className="text-gray-500 text-xs mr-2">{index + 1}.</span>
              <span className="font-mono font-medium">{word}</span>
            </div>
          ))}
        </div>

        <button
          onClick={handleCopy}
          className="mt-6 w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-sm font-medium transition-colors"
        >
          {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
        </button>
      </div>

      <div className="bg-white border-2 border-gray-200 rounded-lg p-6 mb-6">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 w-5 h-5"
          />
          <span className="text-sm text-gray-700">
            I have written down my seed phrase and stored it in a secure location. I
            understand that I will lose access to my wallet if I lose this phrase.
          </span>
        </label>
      </div>

      <button
        onClick={handleConfirm}
        disabled={!confirmed}
        className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
