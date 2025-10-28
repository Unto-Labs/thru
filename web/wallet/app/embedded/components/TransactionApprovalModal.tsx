'use client';

import { truncatePublicKey } from '../utils/appMetadata';

interface AccountOption {
  index: number;
  label?: string | null;
  publicKey: string;
}

interface TransactionApprovalModalProps {
  account: AccountOption | null;
  requestType?: string;
  error: string | null;
  isLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export function TransactionApprovalModal({
  account,
  requestType,
  error,
  isLoading,
  onApprove,
  onReject,
}: TransactionApprovalModalProps) {
  const accountLabel =
    account?.label || (account ? `Account ${account.index + 1}` : 'No account selected');
  const accountAddress = account ? `${truncatePublicKey(account.publicKey)}...` : '—';

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Approve Transaction</h2>
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

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Send from</label>
            <div className="w-full px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-800">
              <div className="font-medium">{accountLabel}</div>
              <div className="text-gray-500 text-xs mt-1 uppercase tracking-wide">Address</div>
              <div className="text-gray-700">{accountAddress}</div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Transaction</label>
            <div className="px-4 py-3 bg-gray-50 rounded-lg text-sm text-gray-800">
              {requestType}
            </div>
          </div>
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
            {isLoading ? 'Approving...' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
