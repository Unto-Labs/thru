import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getShellHtml } from './shell';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_SHELL_OPTIONS = {
  walletUrl: 'https://app.tid.sh/embedded?tn_frame_id=frame_test',
  walletOrigin: 'https://app.tid.sh',
};

describe('native shell HTML', () => {
  it('delegates WebAuthn and clipboard writes to the configured wallet origin only', () => {
    const html = getShellHtml({
      walletUrl: 'https://staging-app.tid.sh/embedded',
      walletOrigin: 'https://staging-app.tid.sh',
    });
    expect(html).toContain(
      'publickey-credentials-get https://staging-app.tid.sh; publickey-credentials-create https://staging-app.tid.sh; clipboard-write https://staging-app.tid.sh'
    );
    expect(html).not.toContain('publickey-credentials-get *');
    expect(html).not.toContain('clipboard-write *');
  });
  it('does not delegate payment permission to the wallet iframe', () => {
    const html = getShellHtml(TEST_SHELL_OPTIONS);

    expect(html).not.toContain('payment *');
  });

  it('forwards WKWebView iframe messages when event.source is unavailable', () => {
    const html = getShellHtml(TEST_SHELL_OPTIONS);

    expect(html).toContain('var fromFrame = e.source === f.contentWindow;');
    expect(html).toContain('var fromWalletOrigin = e.origin === ORIGIN;');
    expect(html).toContain('var hasFrameId = e.data && e.data.frameId === frameId();');
    expect(html).toContain('if (!fromWalletOrigin || (!fromFrame && !hasFrameId)) return;');
  });

  it('forwards native sheet dismissals into the wallet iframe', () => {
    const html = getShellHtml(TEST_SHELL_OPTIONS);

    expect(html).toContain("window.addEventListener('thru:native-sheet-dismiss', function () {");
    expect(html).toContain("type: 'thru:native-sheet-dismiss'");
    expect(html).toContain('postToWallet({');
  });

  it('substitutes shell placeholders without reprocessing inserted values', () => {
    const walletUrl = 'https://app.tid.sh/embedded?marker=WALLET_ORIGIN_PLACEHOLDER';
    const walletOrigin = 'thru-mobile://WALLET_URL_PLACEHOLDER/$&';

    const html = getShellHtml({ walletUrl, walletOrigin });

    expect(html).toContain(`data-src="${walletUrl}"`);
    expect(html).toContain(`var ORIGIN = '${walletOrigin}';`);
  });

  it('keeps the wallet iframe color-scheme in step with the host theme', () => {
    const html = getShellHtml(TEST_SHELL_OPTIONS);

    expect(html).toContain("searchParams.get('tn_theme') === 'dark'");
    expect(html).toContain('f.style.colorScheme = themeFromSrc();');
    expect(html).toContain("msg.type === 'wallet:theme'");
    expect(html).toContain('f.style.colorScheme = msg.theme;');
  });

  it('keeps the standalone shell.html copy identical to the template', () => {
    const template = getShellHtml({
      walletUrl: 'WALLET_URL_PLACEHOLDER',
      walletOrigin: 'WALLET_ORIGIN_PLACEHOLDER',
    });
    const copy = readFileSync(join(__dirname, 'shell.html'), 'utf8');

    expect(copy.trim()).toBe(template.trim());
  });

  it('tags native requests with the wallet frame id before forwarding', () => {
    const html = getShellHtml(TEST_SHELL_OPTIONS);

    expect(html).toContain('outbound = Object.assign({}, msg, { frameId: frameId() });');
    expect(html).toContain('f.contentWindow.postMessage(outbound, ORIGIN);');
  });
});
