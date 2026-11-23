'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { trackPage, type FathomApp } from './index';

/* Sends a Fathom pageview on every client navigation. It re-runs on each
   router pathname change, but sends the browser's own path, so an app served
   under a stripped prefix (thru.org/scan) reports the URL the visitor saw. */
export function Fathom({ app }: { app: FathomApp }) {
  const pathname = usePathname();
  useEffect(() => {
    trackPage(app, window.location.pathname);
  }, [app, pathname]);
  return null;
}
