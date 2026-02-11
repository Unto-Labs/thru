'use client';

import React, { useCallback, useRef } from 'react';
import { SessionProvider } from '@/providers/SessionProvider';
import { PasskeyAuthProvider, type PostSignInHandler } from '@/providers/PasskeyAuthProvider';
import { AccountProvider, useAccounts } from '@/providers/AccountProvider';
import { TransactionProvider } from '@/providers/TransactionProvider';
import { ConnectedAppsProvider } from '@/providers/ConnectedAppsProvider';
import type { DerivedAccount } from '@/types/account';

/**
 * Inner component that wires up the post-sign-in handler to load accounts.
 * Sits inside AccountProvider so it can access account context.
 */
function PostSignInBridge({
  children,
  handlerRef,
}: {
  children: React.ReactNode;
  handlerRef: React.MutableRefObject<PostSignInHandler | null>;
}) {
  const { loadAccounts, loadBalances, setAccounts, embeddedAccountsRef } = useAccounts();

  // Register the handler that PasskeyAuthProvider will call after sign-in
  handlerRef.current = async (popupAccounts: DerivedAccount[] | null) => {
    if (popupAccounts && popupAccounts.length > 0) {
      embeddedAccountsRef.current = popupAccounts;
      setAccounts(popupAccounts);
      await loadBalances(popupAccounts.map((account) => account.publicKey));
      console.log('[WalletProviders] Loaded accounts from popup', {
        count: popupAccounts.length,
      });
    } else {
      await loadAccounts();
    }
  };

  return <>{children}</>;
}

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const postSignInHandlerRef = useRef<PostSignInHandler | null>(null);

  return (
    <SessionProvider>
      <PasskeyAuthProvider postSignInHandlerRef={postSignInHandlerRef}>
        <AccountProvider>
          <PostSignInBridge handlerRef={postSignInHandlerRef}>
            <TransactionProvider>
              <ConnectedAppsProvider>
                {children}
              </ConnectedAppsProvider>
            </TransactionProvider>
          </PostSignInBridge>
        </AccountProvider>
      </PasskeyAuthProvider>
    </SessionProvider>
  );
}
