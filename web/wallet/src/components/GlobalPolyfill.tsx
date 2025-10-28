'use client';

import { useEffect } from 'react';

/**
 * Polyfill for global object required by some crypto libraries
 */
export function GlobalPolyfill() {
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof (window as any).global === 'undefined') {
      (window as any).global = window;
    }
  }, []);

  return null;
}
