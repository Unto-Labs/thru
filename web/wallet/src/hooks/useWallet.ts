import { useContext } from 'react';
import { WalletContext, WalletContextState } from '@/contexts/WalletProvider';

/**
 * Hook to access the WalletContext
 * Must be used within a WalletProvider
 */
export function useWallet(): WalletContextState {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }

  return context;
}
