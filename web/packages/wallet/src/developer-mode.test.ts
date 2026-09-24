import { describe, expect, it } from 'vitest';
import { isWalletDeveloperModeMessage } from './protocol';

describe('wallet developer mode message', () => {
  it('accepts only a well-formed host message', () => {
    const message = {
      type: 'wallet:developer-mode',
      origin: 'https://app.example',
      frameId: 'frame-1',
      enabled: true,
    };
    expect(isWalletDeveloperModeMessage(message)).toBe(true);
    expect(isWalletDeveloperModeMessage({ ...message, enabled: false })).toBe(true);
    expect(isWalletDeveloperModeMessage({ ...message, enabled: 'true' })).toBe(false);
    expect(isWalletDeveloperModeMessage({ ...message, frameId: undefined })).toBe(false);
    expect(isWalletDeveloperModeMessage({ ...message, type: 'wallet:theme' })).toBe(false);
    expect(isWalletDeveloperModeMessage(null)).toBe(false);
  });
});
