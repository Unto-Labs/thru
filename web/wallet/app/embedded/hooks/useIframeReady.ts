import { useEffect } from 'react';
import { IFRAME_READY_EVENT } from '../types';

/**
 * Sends iframe ready event to parent window on mount
 */
export function useIframeReady() {
  useEffect(() => {
    const readyMessage = {
      type: IFRAME_READY_EVENT,
      data: { ready: true },
    };
    window.parent.postMessage(readyMessage, '*');
  }, []);
}

