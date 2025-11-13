'use client';

import { Body3, Body4, Button, Card, Heading5 } from '@thru/design-system';
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
      <div className="bg-surface-yellow border border-border-secondary p-6 mb-6">
        <Heading5 className="text-text-primary mb-2" bold>
          ⚠️ Save Your Seed Phrase
        </Heading5>
        <Body3 className="text-text-secondary">
          Write down these 12 words in order and store them securely. You'll need them to
          recover your wallet. Never share them with anyone.
        </Body3>
      </div>

      <Card variant="default" className="p-6 mb-6">
        <div className="grid grid-cols-3 gap-4">
          {words.map((word, index) => (
            <div
              key={index}
              className="bg-surface-lower p-3 border border-border-tertiary"
            >
              <span className="text-text-tertiary text-xs mr-2">{index + 1}.</span>
              <span className="font-mono font-medium text-text-primary">{word}</span>
            </div>
          ))}
        </div>

        <Button
          onClick={handleCopy}
          variant="outline"
          size="md"
          className="mt-6 w-full"
        >
          {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
        </Button>
      </Card>

      <Card variant="default" className="p-6 mb-6">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 w-5 h-5"
          />
          <Body4 className="text-text-primary">
            I have written down my seed phrase and stored it in a secure location. I
            understand that I will lose access to my wallet if I lose this phrase.
          </Body4>
        </label>
      </Card>

      <Button
        onClick={handleConfirm}
        disabled={!confirmed}
        variant="primary"
        className="w-full"
      >
        Continue
      </Button>
    </div>
  );
}
