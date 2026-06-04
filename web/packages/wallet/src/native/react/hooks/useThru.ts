import { useContext } from 'react';
import { ThruContext, type ThruContextValue } from '../ThruContext';

/** Returns the full ThruContextValue. Throws if used outside <ThruProvider>. */
export function useThru(): ThruContextValue {
  const ctx = useContext(ThruContext);
  if (!ctx) {
    throw new Error('useThru must be used inside <ThruProvider>');
  }
  return ctx;
}
