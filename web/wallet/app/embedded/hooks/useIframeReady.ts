import { useEffect } from 'react';
import { IFRAME_READY_EVENT } from '../types';

/**
 * Sends iframe ready event to parent window on mount
 */
export function useIframeReady() {
  useEffect(() => {
    const frameId = new URLSearchParams(window.location.search).get('tn_frame_id');
    const readyMessage = {
      type: IFRAME_READY_EVENT,
      frameId,
      data: { ready: true },
    };
    window.parent.postMessage(readyMessage, '*');
  }, []);
}
