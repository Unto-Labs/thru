'use client';

import { Body4, Body5, Button, Card, Heading5 } from '@thru/design-system';
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
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-steel-800/30">
      <Card variant="elevated" className="max-w-md w-full">
        <div className="flex items-center justify-between mb-6">
          <Heading5 className="text-text-primary" bold>Approve Transaction</Heading5>
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

        <div className="space-y-4 mb-6">
          <div>
            <Body4 className="text-text-primary mb-2" bold>Send from</Body4>
            <div className="w-full px-4 py-3 border border-border-tertiary bg-surface-lower">
              <Body4 className="text-text-primary" bold>{accountLabel}</Body4>
              <Body5 className="text-text-tertiary mt-1 uppercase tracking-wide">Address</Body5>
              <Body4 className="text-text-primary">{accountAddress}</Body4>
            </div>
          </div>

          <div>
            <Body4 className="text-text-primary mb-2" bold>Transaction</Body4>
            <div className="px-4 py-3 bg-surface-lower border border-border-tertiary">
              <Body4 className="text-text-primary">{requestType}</Body4>
            </div>
          </div>
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
            {isLoading ? 'Approving...' : 'Approve'}
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
