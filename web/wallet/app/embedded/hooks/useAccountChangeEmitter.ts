import { AddressType } from '@thru/chain-interfaces';
import { useEffect, useRef } from 'react';
import { EMBEDDED_PROVIDER_EVENTS, type EmbeddedProviderEvent } from '../types';

interface UseAccountChangeEmitterParams {
  accounts: Array<{ index: number; publicKey: string; label?: string }>;
  selectedAccountIndex: number;
  sendEvent: (eventName: EmbeddedProviderEvent, data?: any) => void;
}

/**
 * Emits account change events when the selected account changes
 */
export function useAccountChangeEmitter({
  accounts,
  selectedAccountIndex,
  sendEvent,
}: UseAccountChangeEmitterParams) {
  const lastEmittedAccountRef = useRef<string | null>(null);

  useEffect(() => {
    const active =
      accounts.find(account => account.index === selectedAccountIndex) ??
      accounts[selectedAccountIndex];

    if (!active) {
      lastEmittedAccountRef.current = null;
      return;
    }

    const payloadAccount = {
      accountType: AddressType.THRU,
      address: active.publicKey,
      label: active.label ?? `Account ${active.index + 1}`,
    };

    if (lastEmittedAccountRef.current === payloadAccount.address) {
      return;
    }

    lastEmittedAccountRef.current = payloadAccount.address;
    sendEvent(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, { account: payloadAccount });
  }, [accounts, selectedAccountIndex, sendEvent]);
}

