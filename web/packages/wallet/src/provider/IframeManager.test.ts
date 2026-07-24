import { describe, expect, it } from 'vitest';
import { IframeManager, WALLET_IFRAME_ALLOW } from './IframeManager';

describe('IframeManager', () => {
  it('delegates Payment Request through the wallet iframe', () => {
    expect(WALLET_IFRAME_ALLOW).toContain('payment *');
  });

  it('allows trusted deployed wallet origins', () => {
    const thruBridge = new IframeManager('https://app.tid.sh/embedded');
    const tidBridge = new IframeManager('https://wallet.tid.sh/embedded');
    const stagingAppBridge = new IframeManager(
      'https://staging-app.tid.sh/embedded'
    );
    const stagingBridge = new IframeManager(
      'https://wallet.staging.web.5f1.net/embedded'
    );

    expect(thruBridge).toBeInstanceOf(IframeManager);
    expect(tidBridge).toBeInstanceOf(IframeManager);
    expect(stagingAppBridge).toBeInstanceOf(IframeManager);
    expect(stagingBridge).toBeInstanceOf(IframeManager);
  });

  it('rejects untrusted production wallet origins', () => {
    expect(
      () => new IframeManager('https://evil.example.com/embedded')
    ).toThrow(/Untrusted iframe origin/);
  });
});
