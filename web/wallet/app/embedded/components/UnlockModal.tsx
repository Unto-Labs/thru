'use client';

import { Body3, Body4, Button, Card, Heading5 /* Input */ } from '@thru/design-system';
// import { KeyboardEvent } from 'react';

interface UnlockModalProps {
  error: string | null;
  isLoading: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

export function UnlockModal({
  error,
  isLoading,
  onSubmit,
  onCancel,
}: UnlockModalProps) {
  // const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
  //   if (event.key === 'Enter') {
  //     event.preventDefault();
  //     onSubmit();
  //   }
  // };

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-steel-800/30">
      <Card variant="elevated" className="max-w-md w-full">
        <div className="flex items-center justify-between mb-6">
          <Heading5 className="text-text-primary" bold>Unlock Wallet</Heading5>
          <Button
            onClick={onCancel}
            variant="ghost"
            size="sm"
            disabled={isLoading}
            className="p-2"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        <Body3 className="text-text-secondary mb-6">
          Authenticate with your passkey to unlock your wallet.
        </Body3>

        {/* Password input disabled for passkey-only flow. */}
        {/* <div className="mb-6">
          <Input
            type="password"
            label="Password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="Enter password"
            disabled={isLoading}
            error={!!error}
            autoFocus
            onKeyDown={handleKeyDown}
          />
        </div> */}

        {error && (
          <div className="mb-4 p-4 bg-surface-brick border border-border-brand rounded-lg">
            <Body4 className="text-text-primary">{error}</Body4>
          </div>
        )}

        <div className="flex gap-3 mb-6">
          <Button
            onClick={onCancel}
            variant="outline"
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            variant="primary"
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? 'Signing in...' : 'Sign In with Passkey'}
          </Button>
        </div>
        <div className="flex justify-center">
          <img 
            src="/logo/lockup-vertical_dark.svg" 
            alt="Thru" 
            className="h-5 w-auto"
          />
        </div>
      </Card>
    </div>
  );
}
