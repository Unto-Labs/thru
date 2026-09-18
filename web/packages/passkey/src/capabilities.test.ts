import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPasskeyPromptMode,
  getPermissionsPolicyAllowsFeature,
  classifyIframeRestriction,
  markInlinePasskeyRefused,
  resetInlinePasskeyRefusal,
  maybePreopenPopup,
} from './capabilities';

const safari = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
function frame(
  ua = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
  sameOrigin = false
) {
  const parent: any = {
    location: { origin: sameOrigin ? 'https://app.tid.sh' : 'https://wallet.tid.sh' },
  };
  parent.parent = parent;
  vi.stubGlobal('window', {
    self: {},
    top: parent,
    parent,
    location: { origin: 'https://app.tid.sh' },
  });
  vi.stubGlobal('navigator', { userAgent: ua });
  vi.stubGlobal('document', {});
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  resetInlinePasskeyRefusal();
  frame();
});

describe('operation-specific iframe routing', () => {
  it('attempts both operations inline without capability or policy APIs', async () => {
    expect(await getPasskeyPromptMode('create')).toBe('inline');
    expect(await getPasskeyPromptMode('get')).toBe('inline');
  });
  it('does not consult asynchronous authenticator capabilities', async () => {
    const probe = vi.fn(() => new Promise(() => {}));
    (window as any).PublicKeyCredential = { getClientCapabilities: probe };
    expect(await getPasskeyPromptMode('create')).toBe('inline');
    expect(probe).not.toHaveBeenCalled();
  });
  it.each([safari, 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/130.0 Mobile Safari/604.1'])(
    'only routes cross-origin WebKit creation to recovery: %s',
    async (ua) => {
      frame(ua);
      expect(await getPasskeyPromptMode('create')).toBe('popup');
      expect(await getPasskeyPromptMode('get')).toBe('inline');
      frame(ua, true);
      expect(await getPasskeyPromptMode('create')).toBe('inline');
    }
  );
  it('keeps same-origin/top-level ceremonies inline', async () => {
    frame(safari, true);
    expect(await getPasskeyPromptMode('create')).toBe('inline');
    (window as any).self = window.top;
    expect(await getPasskeyPromptMode('create')).toBe('inline');
  });
  it('binds the policy receiver and distinguishes denial from unavailable', async () => {
    const policy = {
      allowsFeature(this: any, feature: string) {
        expect(this).toBe(policy);
        return feature.endsWith('-get');
      },
    };
    vi.stubGlobal('document', { permissionsPolicy: policy });
    expect(await getPasskeyPromptMode('get')).toBe('inline');
    expect(await getPasskeyPromptMode('create')).toBe('popup');
    vi.stubGlobal('document', { featurePolicy: policy });
    expect(getPermissionsPolicyAllowsFeature('publickey-credentials-get')).toBe(true);
    vi.stubGlobal('document', {
      permissionsPolicy: {
        allowsFeature() {
          throw new Error('unknown');
        },
      },
    });
    expect(getPermissionsPolicyAllowsFeature('publickey-credentials-get')).toBe(null);
  });
  it('does not let a create refusal affect get', async () => {
    markInlinePasskeyRefused('create', 'ancestor-restriction');
    expect(await getPasskeyPromptMode('create')).toBe('popup');
    expect(await getPasskeyPromptMode('get')).toBe('inline');
  });
  it('never speculatively opens a popup', () => {
    frame(safari);
    const open = vi.fn();
    expect(maybePreopenPopup('create', open)).toBe(null);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('restriction classification', () => {
  it.each([
    ["Invalid 'sameOriginWithAncestors' value", 'Error'],
    ['The origin of the document is not the same as its ancestors.', 'NotAllowedError'],
    ['The permissions policy for this iframe forbids it', 'NotAllowedError'],
  ])('recognizes a specific restriction: %s', (message, name) => {
    expect(
      classifyIframeRestriction(Object.assign(new Error(message), { name }), 'create')?.action
    ).toBe('create');
  });
  it.each([
    ['blocked', 'SecurityError'],
    ['Invalid RP ID', 'SecurityError'],
    ['TLS certificate errors', 'SecurityError'],
    ['User cancelled', 'NotAllowedError'],
    ['Timed out or not allowed', 'NotAllowedError'],
    ['Document is not focused', 'NotAllowedError'],
    ['iframe operation aborted', 'AbortError'],
  ])('does not mistake other errors for iframe restrictions: %s', (message, name) => {
    expect(classifyIframeRestriction(Object.assign(new Error(message), { name }), 'get')).toBe(
      null
    );
  });
});
