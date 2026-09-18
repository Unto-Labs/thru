import { describe, expect, it } from 'vitest';
import { walletButtonReloadDelayMs } from './WalletButton';

describe('wallet button ready watchdog', () => {
  it('backs off over three reloads, then stops', () => {
    expect(walletButtonReloadDelayMs(0)).toBe(8_000);
    expect(walletButtonReloadDelayMs(1)).toBe(16_000);
    expect(walletButtonReloadDelayMs(2)).toBe(32_000);
    expect(walletButtonReloadDelayMs(3)).toBeNull();
  });
});
