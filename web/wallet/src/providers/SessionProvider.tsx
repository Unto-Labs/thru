'use client';

import type { NetworkType } from '@/lib/wallet/wallet-manager';
import { LOCK_TIMEOUT_MS } from '@/lib/wallet/utils';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export interface SessionContextState {
  isUnlocked: boolean;
  autoLockCount: number;
  network: NetworkType;
  lockWallet: (reason?: 'manual' | 'auto') => void;
  resetLockTimer: () => void;
  setIsUnlocked: (unlocked: boolean) => void;
  setNetwork: (network: NetworkType) => void;
  lockTimerRef: React.MutableRefObject<number | null>;
  ephemeralPasskeySessionRef: React.MutableRefObject<boolean>;
}

export const SessionContext = createContext<SessionContextState | null>(null);

export function useSession(): SessionContextState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [autoLockCount, setAutoLockCount] = useState(0);
  const [network, setNetwork] = useState<NetworkType>('default');
  const lockTimerRef = useRef<number | null>(null);
  const ephemeralPasskeySessionRef = useRef<boolean>(false);

  // The lockWallet callback clears UI state through a registered handler.
  // PasskeyAuthProvider registers a handler that clears passkey ephemeral state.
  const onLockHandlersRef = useRef<Array<() => void>>([]);

  const lockWallet = useCallback((reason: 'manual' | 'auto' = 'manual') => {
    if (lockTimerRef.current !== null) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }

    setIsUnlocked(false);

    // Notify all registered lock handlers
    for (const handler of onLockHandlersRef.current) {
      handler();
    }

    if (reason === 'auto') {
      setAutoLockCount((count) => count + 1);
    }
  }, []);

  const resetLockTimer = useCallback(() => {
    if (lockTimerRef.current !== null) {
      clearTimeout(lockTimerRef.current);
    }

    lockTimerRef.current = window.setTimeout(() => {
      console.log('[SessionProvider] Auto-locking wallet after inactivity');
      lockWallet('auto');
    }, LOCK_TIMEOUT_MS) as unknown as number;
  }, [lockWallet]);

  // Cleanup lock timer on unmount
  useEffect(() => {
    return () => {
      if (lockTimerRef.current !== null) {
        clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    };
  }, []);

  const value: SessionContextState = {
    isUnlocked,
    autoLockCount,
    network,
    lockWallet,
    resetLockTimer,
    setIsUnlocked,
    setNetwork,
    lockTimerRef,
    ephemeralPasskeySessionRef,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
