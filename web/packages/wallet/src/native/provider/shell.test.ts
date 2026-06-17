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
  it('forwards WKWebView iframe messages when event.source is unavailable', () => {
    const html = getShellHtml(TEST_SHELL_OPTIONS);

    expect(html).toContain('var fromFrame = e.source === f.contentWindow;');
    expect(html).toContain('var fromWalletOrigin = e.origin === ORIGIN;');
    expect(html).toContain(
      'var hasFrameId = e.data && e.data.frameId === frameId();'
    );
    expect(html).toContain(
      'if (!fromWalletOrigin || (!fromFrame && !hasFrameId)) return;'
    );
  });

  it('forwards native sheet dismissals into the wallet iframe', () => {
    const html = getShellHtml(TEST_SHELL_OPTIONS);

    expect(html).toContain(
      "window.addEventListener('thru:native-sheet-dismiss', function () {"
    );
    expect(html).toContain("type: 'thru:native-sheet-dismiss'");
    expect(html).toContain('postToWallet({');
  });

  it('substitutes shell placeholders without reprocessing inserted values', () => {
    const walletUrl =
      'https://app.tid.sh/embedded?marker=WALLET_ORIGIN_PLACEHOLDER';
    const walletOrigin = 'thru-mobile://WALLET_URL_PLACEHOLDER/$&';

    const html = getShellHtml({ walletUrl, walletOrigin });

    expect(html).toContain(`data-src="${walletUrl}"`);
    expect(html).toContain(`var ORIGIN = '${walletOrigin}';`);
  });

  it('tags native requests with the wallet frame id before forwarding', () => {
    const html = getShellHtml(TEST_SHELL_OPTIONS);

    expect(html).toContain(
      'outbound = Object.assign({}, msg, { frameId: frameId() });'
    );
    expect(html).toContain('f.contentWindow.postMessage(outbound, ORIGIN);');
  });
});
