'use client';

import { useState, useRef, KeyboardEvent } from 'react';

interface SeedPhraseInputProps {
  onSubmit: (mnemonic: string) => void;
}

export function SeedPhraseInput({ onSubmit }: SeedPhraseInputProps) {
  const [words, setWords] = useState<string[]>(Array(12).fill(''));
  const [error, setError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleWordChange = (index: number, value: string) => {
    const newWords = [...words];
    newWords[index] = value.trim().toLowerCase();
    setWords(newWords);
    setError('');

    // Auto-focus next input
    if (value.trim() && index < 11) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !words[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const pastedWords = pastedText.trim().toLowerCase().split(/\s+/);

    if (pastedWords.length === 12) {
      setWords(pastedWords);
      setError('');
    } else {
      setError(`Expected 12 words, got ${pastedWords.length}`);
    }
  };

  const handleSubmit = () => {
    setError('');

    // Check if all words are filled
    if (words.some((word) => !word)) {
      setError('Please fill in all 12 words');
      return;
    }

    const mnemonic = words.join(' ');
    onSubmit(mnemonic);
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-blue-50 border-2 border-blue-400 rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">
          ℹ️ Import Your Wallet
        </h3>
        <p className="text-blue-800 text-sm">
          Enter your 12-word seed phrase to restore your wallet. You can paste all words at
          once or enter them individually.
        </p>
      </div>

      <div className="bg-white border-2 border-gray-200 rounded-lg p-6 mb-6">
        <div className="grid grid-cols-3 gap-4" onPaste={handlePaste}>
          {words.map((word, index) => (
            <div key={index} className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">
                {index + 1}.
              </span>
              <input
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                value={word}
                onChange={(e) => handleWordChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="w-full pl-8 pr-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none font-mono text-sm"
                placeholder="word"
                autoComplete="off"
                spellCheck="false"
              />
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={words.some((word) => !word)}
        className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
