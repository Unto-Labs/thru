'use client';

import { Body3, Body4, Body5, Button, Card, Heading5 } from '@thru/design-system';
import type { AppMetadata } from '../types';
import { getDisplayAppName, getDisplayAppUrl } from '../utils/appMetadata';

interface ConnectModalProps {
  origin?: string;
  metadata?: AppMetadata;
  error: string | null;
  isLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export function ConnectModal({
  origin,
  metadata,
  error,
  isLoading,
  onApprove,
  onReject,
}: ConnectModalProps) {
  const displayName = getDisplayAppName(metadata, origin);
  const displayUrl = getDisplayAppUrl(metadata, origin);
  const logoText = displayName.charAt(0).toUpperCase();
  const logoUrl = metadata?.imageUrl;

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-steel-800/30">
      <Card variant="elevated" className="max-w-md w-full">
        <div className="flex items-center justify-between mb-6">
          <Heading5 className="text-text-primary" bold>Sign in with Thru</Heading5>
          <Button
            onClick={onReject}
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

        <div className="flex items-center gap-4 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-lower border border-border-tertiary text-text-primary text-lg font-semibold overflow-hidden">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={displayName}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span>{logoText || 'A'}</span>
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <Body3 className="text-text-primary truncate" bold>{displayName}</Body3>
            {displayUrl && (
              <Body5 className="text-text-tertiary truncate" title={displayUrl}>
                {displayUrl}
              </Body5>
            )}
          </div>
        </div>

        <Body3 className="text-text-secondary mb-6">
          {displayName} wants to connect to your wallet.
        </Body3>

        <div className="mb-6 p-4 bg-surface-lower border border-border-tertiary">
          <Body4 className="text-text-primary mb-2" bold>This will allow the app to:</Body4>
          <ul className="space-y-1">
            <li>
              <Body4 className="text-text-secondary">• View your wallet addresses</Body4>
            </li>
            <li>
              <Body4 className="text-text-secondary">• Request transaction approvals</Body4>
            </li>
          </ul>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-surface-brick border border-border-brand rounded-lg">
            <Body4 className="text-text-primary">{error}</Body4>
          </div>
        )}

        <div className="flex gap-3 mb-6">
          <Button
            onClick={onReject}
            variant="outline"
            disabled={isLoading}
            className="flex-1"
          >
            Reject
          </Button>
          <Button
            onClick={onApprove}
            variant="primary"
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? 'Connecting...' : 'Connect'}
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
