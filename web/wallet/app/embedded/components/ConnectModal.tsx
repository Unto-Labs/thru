'use client';

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
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Sign in with Thru</h2>
          <button
            onClick={onReject}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isLoading}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-lg font-semibold overflow-hidden">
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
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-gray-900">{displayName}</span>
            {displayUrl && (
              <span className="text-sm text-gray-500 truncate" title={displayUrl}>
                {displayUrl}
              </span>
            )}
          </div>
        </div>

        <p className="text-gray-600 mb-6">
          {displayName} wants to connect to your wallet.
        </p>

        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-700 mb-2 font-medium">This will allow the app to:</p>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• View your wallet addresses</li>
            <li>• Request transaction approvals</li>
          </ul>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onReject}
            className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
            disabled={isLoading}
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
            disabled={isLoading}
          >
            {isLoading ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
