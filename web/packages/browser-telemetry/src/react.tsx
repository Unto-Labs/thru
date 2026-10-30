'use client';
import { useEffect } from 'react';
import { installBrowserTelemetry } from './index';
export function BrowserTelemetry() {
  useEffect(() => installBrowserTelemetry(), []);
  return null;
}
