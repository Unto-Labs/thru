import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { signWithStoredPasskey, signWithDiscoverablePasskey } from './sign';
import type { PasskeyMetadata } from './types';
const popup = vi.hoisted(() => ({ request: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock('./popup', () => ({
  requestPasskeyPopup: popup.request,
  openPasskeyPopupWindow: popup.open,
  closePopup: popup.close,
}));
const signed = {
  signatureBase64Url: 'AQ',
  authenticatorDataBase64Url: 'Ag',
  clientDataJSONBase64Url: 'Aw',
  signatureRBase64Url: 'BA',
  signatureSBase64Url: 'BQ',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', {
    PublicKeyCredential: function () {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('navigator', { credentials: {} });
  popup.open.mockReturnValue({});
});
afterEach(() => vi.unstubAllGlobals());
it('keeps the selected signing credential and RP ID in explicit popup mode', async () => {
  const selected = { credentialId: 'selected-credential', rpId: 'app.tid.sh' } as PasskeyMetadata;
  popup.request.mockResolvedValue(signed);
  const result = await signWithStoredPasskey(
    new Uint8Array([1]),
    'app.tid.sh',
    selected,
    [selected],
    undefined,
    { promptMode: 'popup', allowDiscoverableFallback: false }
  );
  expect(popup.request).toHaveBeenCalledWith(
    'get',
    expect.objectContaining({ credentialId: selected.credentialId, rpId: selected.rpId }),
    expect.anything(),
    expect.anything()
  );
  expect(result.passkey).toBe(selected);
});
/* The account switch in a popup-only browser: a stored passkey must NOT pin the
   popup to that credential, or the user can never reach another one. */
it('hands the popup a discoverable request when a switch forces the picker', async () => {
  const selected = { credentialId: 'selected-credential', rpId: 'app.tid.sh' } as PasskeyMetadata;
  popup.request.mockResolvedValue({
    ...signed,
    passkey: { credentialId: 'picked-credential', rpId: 'app.tid.sh' },
  });
  const result = await signWithStoredPasskey(
    new Uint8Array([1]),
    'app.tid.sh',
    selected,
    [selected],
    undefined,
    { promptMode: 'popup', preferDiscoverable: true }
  );
  expect(popup.request).toHaveBeenCalledWith(
    'getStored',
    expect.objectContaining({ rpId: 'app.tid.sh', preferDiscoverable: true }),
    expect.anything(),
    expect.anything()
  );
  expect(popup.request).not.toHaveBeenCalledWith(
    'get',
    expect.anything(),
    expect.anything(),
    expect.anything()
  );
  expect(result.passkey.credentialId).toBe('picked-credential');
});
it('passes the requested RP ID and discoverable preference to popup recovery', async () => {
  popup.request.mockResolvedValue({
    ...signed,
    passkey: { credentialId: 'discovered', rpId: 'staging-app.tid.sh' },
  });
  const result = await signWithDiscoverablePasskey(new Uint8Array([1]), 'staging-app.tid.sh', {
    promptMode: 'popup',
  });
  expect(popup.request).toHaveBeenCalledWith(
    'getStored',
    expect.objectContaining({ rpId: 'staging-app.tid.sh', preferDiscoverable: true }),
    expect.anything(),
    expect.anything()
  );
  expect(result.credentialId).toBe('discovered');
});
