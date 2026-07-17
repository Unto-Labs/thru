import { describe, expect, it } from 'vitest';
import { IframeManager } from './IframeManager';

describe('IframeManager', () => {
  it('allows trusted deployed wallet origins', () => {
    const thruBridge = new IframeManager('https://app.tid.sh/embedded');
    const tidBridge = new IframeManager('https://wallet.tid.sh/embedded');
    const stagingBridge = new IframeManager(
      'https://wallet.staging.web.5f1.net/embedded'
    );

    expect(thruBridge).toBeInstanceOf(IframeManager);
    expect(tidBridge).toBeInstanceOf(IframeManager);
    expect(stagingBridge).toBeInstanceOf(IframeManager);
  });

  it('rejects untrusted production wallet origins', () => {
    expect(
      () => new IframeManager('https://evil.example.com/embedded')
    ).toThrow(/Untrusted iframe origin/);
  });
});
