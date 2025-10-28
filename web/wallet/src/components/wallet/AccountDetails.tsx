import { DerivedAccount } from '@/types/account';
import { useState } from 'react';

interface AccountDetailsProps {
  account: DerivedAccount | null;
  balance: bigint;
  isRefreshing: boolean;
  onRefresh: () => void;
  onRename: (newLabel: string) => void;
  onTransfer: (to: string, amount: bigint) => Promise<void>;
  isSending: boolean;
}

export function AccountDetails({
  account,
  balance,
  isRefreshing,
  onRefresh,
  onRename,
  onTransfer,
  isSending,
}: AccountDetailsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [copiedAddress, setCopiedAddress] = useState(false);

  if (!account) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>Select an account to view details</p>
      </div>
    );
  }

  const balanceSOL = Number(balance) / 1e9;

  const handleStartEdit = () => {
    setEditLabel(account.label);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (editLabel.trim() !== account.label) {
      onRename(editLabel.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditLabel('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(account.publicKey);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Account Header */}
      <div className="bg-white border-2 border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          {isEditing ? (
            <div className="flex-1 flex items-center gap-2">
              <input
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 px-3 py-2 border-2 border-blue-500 rounded-lg focus:outline-none"
                autoFocus
              />
              <button
                onClick={handleSaveEdit}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Save
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold">{account.label}</h2>
              <button
                onClick={handleStartEdit}
                className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
              >
                Rename
              </button>
            </>
          )}
        </div>

        {/* Address */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 bg-gray-50 border-2 border-gray-200 rounded-lg font-mono text-sm truncate">
              {account.publicKey}
            </div>
            <button
              onClick={handleCopyAddress}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm whitespace-nowrap"
            >
              {copiedAddress ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Balance */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Balance</label>
          <div className="flex items-center justify-between">
            <div className="text-3xl font-bold">
              {balanceSOL.toFixed(4)} <span className="text-lg text-gray-500">SOL</span>
            </div>
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed text-sm"
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
