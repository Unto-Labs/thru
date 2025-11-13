import { useCallback } from 'react';
import { useEmbeddedAppStore, type EmbeddedAppStoreDeps } from '../store/useEmbeddedAppStore';

interface UseModalHandlersParams {
  deps: EmbeddedAppStoreDeps;
}

/**
 * Creates event handlers for modal interactions
 */
export function useModalHandlers({ deps }: UseModalHandlersParams) {
  const approveConnection = useEmbeddedAppStore(state => state.approveConnection);
  const handleApproveTransaction = useEmbeddedAppStore(state => state.handleApproveTransaction);
  const handleUnlock = useEmbeddedAppStore(state => state.handleUnlock);
  const rejectRequest = useEmbeddedAppStore(state => state.handleReject);
  const setPassword = useEmbeddedAppStore(state => state.setPassword);

  const handleApproveConnect = useCallback(() => {
    approveConnection({}, deps);
  }, [approveConnection, deps]);

  const handleRejectRequest = useCallback(() => {
    rejectRequest(deps);
    setPassword('');
  }, [rejectRequest, setPassword, deps]);

  const handleUnlockSubmit = useCallback(() => {
    handleUnlock(deps);
  }, [handleUnlock, deps]);

  const handleApproveTransactionClick = useCallback(() => {
    handleApproveTransaction(deps);
  }, [handleApproveTransaction, deps]);

  return {
    handleApproveConnect,
    handleRejectRequest,
    handleUnlockSubmit,
    handleApproveTransactionClick,
  };
}

