import { useCallback } from 'react';
import { POST_MESSAGE_EVENT_TYPE, type EmbeddedProviderEvent, type InferPostMessageResponse, type PostMessageRequest } from '../types';

/**
 * Creates postMessage utilities for communicating with parent window
 */
export function usePostMessage() {
  const sendResponse = useCallback(
    <T extends PostMessageRequest>(response: InferPostMessageResponse<T>) => {
      window.parent.postMessage(response, '*');
    },
    []
  );

  const sendEvent = useCallback((eventName: EmbeddedProviderEvent, data?: any) => {
    const event = {
      type: POST_MESSAGE_EVENT_TYPE,
      event: eventName,
      data,
    };
    window.parent.postMessage(event, '*');
  }, []);

  return { sendResponse, sendEvent };
}

