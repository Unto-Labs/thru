'use client';

import { Button } from '@thru/design-system';
import type { AppMetadata } from '../types';

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
  const name = metadata?.appName || metadata?.appId || origin || 'This app';
  const url = metadata?.appUrl || origin;
  const imageUrl = metadata?.imageUrl;
  const logoText = (name || 'A').charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border-tertiary bg-surface-higher p-6 shadow-lg">
        <div className="mb-5 flex flex-col items-center gap-4 text-center">
          <img
            src="/logo/thru-logo.svg"
            alt="Thru"
            className="h-[72px] w-[72px] opacity-90"
          />

          <div className="flex flex-col items-center gap-2">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-border-tertiary bg-surface-lower text-sm font-semibold text-text-primary">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={name}
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span>{logoText}</span>
              )}
            </div>

            <div className="min-w-0">
              <div className="truncate font-semibold text-text-primary">{name}</div>
              {url && (
                <div className="truncate text-xs text-text-tertiary" title={url}>
                  {url}
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="mb-4 text-sm text-text-secondary">
          Connect to your Thru wallet to view addresses and request transaction approvals.
        </p>

        {error && (
          <div className="mb-4 w-full rounded-lg border border-border-brand bg-surface-brick p-2 text-xs text-text-primary">
            {error}
          </div>
        )}

        <div className="flex gap-3">
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
      </div>
    </div>
  );
}
