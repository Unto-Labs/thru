import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWalletThemeMessage } from './protocol';
import { stubColorSchemeMedia } from './test-utils/match-media';
import {
  normalizeWalletThemePreference,
  readSystemTheme,
  resolveWalletTheme,
  watchSystemTheme,
} from './theme';

afterEach(() => vi.unstubAllGlobals());

describe('wallet theme', () => {
  it('accepts light, dark and system, and draws light for anything else', () => {
    expect(normalizeWalletThemePreference('dark')).toBe('dark');
    expect(normalizeWalletThemePreference('system')).toBe('system');
    expect(normalizeWalletThemePreference('light')).toBe('light');
    expect(normalizeWalletThemePreference(undefined)).toBe('light');
    expect(normalizeWalletThemePreference('sepia')).toBe('light');
  });

  it('resolves system to the OS scheme and keeps a fixed choice', () => {
    expect(resolveWalletTheme('system', 'dark')).toBe('dark');
    expect(resolveWalletTheme('system', 'light')).toBe('light');
    expect(resolveWalletTheme('light', 'dark')).toBe('light');
    expect(resolveWalletTheme('dark', 'light')).toBe('dark');
  });

  it('reads light where matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(readSystemTheme()).toBe('light');
    const onChange = vi.fn();
    const stop = watchSystemTheme(onChange);
    stop();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reads and follows the OS scheme until unsubscribed', () => {
    const media = stubColorSchemeMedia(true);
    expect(readSystemTheme()).toBe('dark');

    const onChange = vi.fn();
    const stop = watchSystemTheme(onChange);
    media.setDark(false);
    expect(onChange).toHaveBeenLastCalledWith('light');

    stop();
    media.setDark(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(media.listeners.size).toBe(0);
  });

  it('falls back to the legacy listener API', () => {
    let listener: ((event: { matches: boolean }) => void) | undefined;
    const query = {
      matches: false,
      addListener: vi.fn((next: typeof listener) => {
        listener = next;
      }),
      removeListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => query));

    const onChange = vi.fn();
    const stop = watchSystemTheme(onChange);
    listener?.({ matches: true });
    expect(onChange).toHaveBeenCalledWith('dark');
    stop();
    expect(query.removeListener).toHaveBeenCalledWith(listener);
  });

  it('recognises only well-formed theme messages', () => {
    const message = { type: 'wallet:theme', origin: 'https://dapp.example', frameId: 'frame_1', theme: 'dark' };
    expect(isWalletThemeMessage(message)).toBe(true);
    expect(isWalletThemeMessage({ ...message, theme: 'system' })).toBe(false);
    expect(isWalletThemeMessage({ ...message, frameId: undefined })).toBe(false);
    expect(isWalletThemeMessage({ ...message, type: 'telemetry:context' })).toBe(false);
    expect(isWalletThemeMessage(null)).toBe(false);
  });
});
