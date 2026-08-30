import { describe, expect, it } from 'vitest';
import {
  decodeTelemetryAppContext,
  encodeTelemetryAppContext,
  sanitizeTelemetryAppContext,
} from './app-context';

describe('sanitizeTelemetryAppContext', () => {
  it('accepts bounded keys and values', () => {
    expect(sanitizeTelemetryAppContext({ tier: 'gold', anon_id: 'ab12-cd34' })).toEqual({
      anon_id: 'ab12-cd34',
      tier: 'gold',
    });
  });

  it('drops entries the ingestion contract cannot accept', () => {
    expect(
      sanitizeTelemetryAppContext({
        tier: 'gold',
        Tier: 'gold',
        'dotted.key': 'x',
        empty: '',
        email: 'user@example.com',
        prose: 'signed in ok',
        long: 'x'.repeat(65),
        numeric: 42,
      }),
    ).toEqual({ tier: 'gold' });
  });

  it('keeps at most five keys in a deterministic order', () => {
    const sanitized = sanitizeTelemetryAppContext({
      f: '6',
      e: '5',
      d: '4',
      c: '3',
      b: '2',
      a: '1',
    });
    expect(Object.keys(sanitized ?? {})).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('rejects non-object input and empty results', () => {
    expect(sanitizeTelemetryAppContext(undefined)).toBeUndefined();
    expect(sanitizeTelemetryAppContext(['tier'])).toBeUndefined();
    expect(sanitizeTelemetryAppContext({ TIER: 'gold' })).toBeUndefined();
  });
});

describe('telemetry app context URL encoding', () => {
  it('round-trips a sanitized context', () => {
    const encoded = encodeTelemetryAppContext({ tier: 'gold', anon_id: 'ab12' });
    expect(encoded).toBe('anon_id=ab12,tier=gold');
    expect(decodeTelemetryAppContext(encoded)).toEqual({ anon_id: 'ab12', tier: 'gold' });
  });

  it('re-validates decoded pairs', () => {
    expect(decodeTelemetryAppContext('tier=gold,BAD=x,broken')).toEqual({ tier: 'gold' });
    expect(decodeTelemetryAppContext('')).toBeUndefined();
    expect(decodeTelemetryAppContext('=gold')).toBeUndefined();
  });
});
