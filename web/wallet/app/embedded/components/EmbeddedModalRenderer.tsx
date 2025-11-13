import { useEmbeddedAppStore } from '../store/useEmbeddedAppStore';
import { ConnectModal } from './ConnectModal';
import { TransactionApprovalModal } from './TransactionApprovalModal';
import { UnlockModal } from './UnlockModal';

interface EmbeddedModalRendererProps {
  accounts: Array<{ index: number; publicKey: string; label?: string }>;
  selectedAccountIndex: number;
  handlers: {
    handleApproveConnect: () => void;
    handleRejectRequest: () => void;
    handleUnlockSubmit: () => void;
    handleApproveTransactionClick: () => void;
  };
}

/**
 * Renders the appropriate modal based on store state
 */
export function EmbeddedModalRenderer({
  accounts,
  selectedAccountIndex,
  handlers,
}: EmbeddedModalRendererProps) {
  const modalType = useEmbeddedAppStore(state => state.modalType);
  const pendingRequest = useEmbeddedAppStore(state => state.pendingRequest);
  const appMetadata = useEmbeddedAppStore(state => state.appMetadata);
  const error = useEmbeddedAppStore(state => state.error);
  const isLoading = useEmbeddedAppStore(state => state.isLoading);
  const password = useEmbeddedAppStore(state => state.password);
  const setPassword = useEmbeddedAppStore(state => state.setPassword);

  if (!modalType) {
    return null;
  }

  switch (modalType) {
    case 'connect':
      return (
        <ConnectModal
          origin={pendingRequest?.origin}
          metadata={appMetadata ?? undefined}
          error={error}
          isLoading={isLoading}
          onApprove={handlers.handleApproveConnect}
          onReject={handlers.handleRejectRequest}
        />
      );
    case 'unlock':
      return (
        <UnlockModal
          password={password}
          error={error}
          isLoading={isLoading}
          onPasswordChange={setPassword}
          onSubmit={handlers.handleUnlockSubmit}
          onCancel={handlers.handleRejectRequest}
        />
      );
    case 'approve-transaction': {
      const activeAccount =
        accounts.find(account => account.index === selectedAccountIndex) ??
        accounts[selectedAccountIndex] ??
        null;
      return (
        <TransactionApprovalModal
          account={activeAccount}
          requestType={pendingRequest?.type}
          error={error}
          isLoading={isLoading}
          onApprove={handlers.handleApproveTransactionClick}
          onReject={handlers.handleRejectRequest}
        />
      );
    }
    default:
      return null;
  }
}

