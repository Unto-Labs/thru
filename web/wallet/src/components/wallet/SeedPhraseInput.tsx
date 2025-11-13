'use client';

import { Body3, Body4, Button, Card, Input } from '@thru/design-system';
import { KeyboardEvent, useRef, useState } from 'react';

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
      <div className="border border-border-secondary p-6 mb-6">
        <Body3 className="text-text-secondary">
          Enter your 12-word seed phrase to restore your wallet. You can paste all words at
          once or enter them individually.
        </Body3>
      </div>

      <Card variant="default" className="p-6 mb-6">
        <div className="grid grid-cols-3 gap-4" onPaste={handlePaste}>
          {words.map((word, index) => (
            <div key={index} className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 z-10 text-text-tertiary text-xs pointer-events-none">
                {index + 1}.
              </span>
              <Input
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                value={word}
                onChange={(e) => handleWordChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="pl-8 font-mono text-sm"
                placeholder="word"
                autoComplete="off"
                spellCheck="false"
              />
            </div>
          ))}
        </div>
      </Card>

      {error && (
        <div className="bg-surface-brick border border-border-brand p-4 mb-6">
          <Body4 className="text-text-primary">{error}</Body4>
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={words.some((word) => !word)}
        variant="primary"
        className="w-full"
      >
        Continue
      </Button>
    </div>
  );
}
