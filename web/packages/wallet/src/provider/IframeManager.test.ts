import { describe, expect, it } from 'vitest';
import { IframeManager } from './IframeManager';

describe('IframeManager', () => {
  it('allows trusted production wallet origins', () => {
    const thruBridge = new IframeManager('https://wallet.thru.org/embedded');
    const tidBridge = new IframeManager('https://wallet.tid.sh/embedded');

    expect(thruBridge).toBeInstanceOf(IframeManager);
    expect(tidBridge).toBeInstanceOf(IframeManager);
  });

  it('rejects untrusted production wallet origins', () => {
    expect(
      () => new IframeManager('https://evil.example.com/embedded')
    ).toThrow(/Untrusted iframe origin/);
  });
});
