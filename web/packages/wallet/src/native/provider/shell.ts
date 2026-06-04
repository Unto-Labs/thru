const SHELL_HTML_TEMPLATE = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>thru-shell</title>
  <style>
    html, body, iframe {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      border: 0;
      background: transparent;
    }
  </style>
</head>
<body>
  <iframe
    id="w"
    data-src="WALLET_URL_PLACEHOLDER"
    allow="publickey-credentials-get *; publickey-credentials-create *"
  ></iframe>
  <script>
    (function () {
      var f = document.getElementById('w');
      var ORIGIN = 'WALLET_ORIGIN_PLACEHOLDER';
      function frameId() {
        try {
          return new URL(f.dataset.src).searchParams.get('tn_frame_id');
        } catch (err) {
          return null;
        }
      }
      function postShell(type, data) {
        var rn = window.ReactNativeWebView;
        if (!rn || !rn.postMessage) return;
        try {
          rn.postMessage(JSON.stringify({
            type: type,
            frameId: frameId(),
            data: data || {}
          }));
        } catch (err) {
          /* drop unserializable messages */
        }
      }
      function postToWallet(msg) {
        if (!f.contentWindow) return;
        var outbound = msg;
        if (msg && typeof msg === 'object') {
          outbound = Object.assign({}, msg, { frameId: frameId() });
        }
        f.contentWindow.postMessage(outbound, ORIGIN);
      }
      window.addEventListener('message', function (e) {
        var fromFrame = e.source === f.contentWindow;
        var fromWalletOrigin = e.origin === ORIGIN;
        var hasFrameId = e.data && e.data.frameId === frameId();
        if (!fromWalletOrigin || (!fromFrame && !hasFrameId)) return;
        var rn = window.ReactNativeWebView;
        if (rn && rn.postMessage) {
          try {
            rn.postMessage(JSON.stringify(e.data));
          } catch (err) {
            /* drop unserializable messages */
          }
        }
      });
      window.__pushIn = postToWallet;
      window.addEventListener('thru:native-sheet-dismiss', function () {
        postToWallet({
          type: 'thru:native-sheet-dismiss',
          frameId: frameId()
        });
      });
      f.addEventListener('load', function () {
        postShell('shell:iframe-load', { src: f.src });
      });
      f.addEventListener('error', function () {
        postShell('shell:iframe-error', { src: f.src });
      });
      postShell('shell:loading', { src: f.dataset.src });
      f.src = f.dataset.src;
    })();
  </script>
</body>
</html>`;
const SHELL_PLACEHOLDER_PATTERN =
  /WALLET_URL_PLACEHOLDER|WALLET_ORIGIN_PLACEHOLDER/g;

export interface ShellOptions {
  walletUrl: string;
  walletOrigin: string;
}

/**
 * Returns the shell HTML for loading wallet.thru.org/embedded inside a
 * react-native-webview. The shell hosts an <iframe> pointing at the wallet
 * and bridges window.postMessage traffic between the iframe and the
 * react-native-webview's onMessage / injectJavaScript channels.
 *
 * Caller substitutes the placeholders with the runtime wallet URL + origin.
 */
export function getShellHtml(opts: ShellOptions): string {
  return SHELL_HTML_TEMPLATE.replace(SHELL_PLACEHOLDER_PATTERN, (placeholder) =>
    placeholder === 'WALLET_URL_PLACEHOLDER'
      ? opts.walletUrl
      : opts.walletOrigin
  );
}
