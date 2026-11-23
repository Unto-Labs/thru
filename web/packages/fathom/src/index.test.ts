import { afterEach, describe, expect, it, vi } from 'vitest';

const fathom = vi.hoisted(() => ({ load: vi.fn(), trackPageview: vi.fn() }));
vi.mock('fathom-client', () => fathom);

const ADDRESS = `ta${'A'.repeat(44)}`;
const SIGNATURE = `ts${'b'.repeat(88)}`;

describe('templatePath', async () => {
  const { templatePath } = await import('./index');

  it('keeps route words', () => {
    expect(templatePath('/')).toBe('/');
    expect(templatePath('/keys/new')).toBe('/keys/new');
    expect(templatePath('/organization/members/')).toBe('/organization/members');
  });

  it('replaces identifiers with fixed names', () => {
    expect(templatePath(`/address/${ADDRESS}`)).toBe('/address/:address');
    expect(templatePath(`/scan/tx/${SIGNATURE}`)).toBe('/scan/tx/:signature');
    expect(templatePath('/block/123456')).toBe('/block/:number');
    expect(templatePath('/invite/0b6f8e2a-9c1d-4b7e-8f3a-2d5c6e7f8a9b')).toBe('/invite/:id');
    expect(templatePath('/key/9f86d081884c7d659a2feaa0c55ad015')).toBe('/key/:id');
    expect(templatePath(`/x/${'Z'.repeat(40)}`)).toBe('/x/:id');
  });

  it('matches percent-encoded identifiers', () => {
    expect(templatePath(`/address/%74${ADDRESS.slice(1)}`)).toBe('/address/:address');
    expect(templatePath('/block/%31%32')).toBe('/block/:number');
    expect(templatePath('/x/%E0%A4%A')).toBe('/x/:id');
    expect(templatePath('/my%20page')).toBe('/my%20page');
  });
});

describe('fathomSiteId', async () => {
  const { fathomSiteId } = await import('./index');

  it('reports only from the app prod hosts', () => {
    expect(fathomSiteId('platform', 'dev.thru.org')).toBe('KEBFLGKD');
    expect(fathomSiteId('explorer', 'thru.org')).toBe('HVJDZCHH');
    expect(fathomSiteId('platform', 'dev.staging.web.5f1.net')).toBeNull();
    expect(fathomSiteId('faucet', 'localhost')).toBeNull();
  });
});

describe('trackPage', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function onHost(hostname: string, search = '') {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname, search } } });
    return import('./index');
  }

  it('loads Fathom once and counts each visit under its template', async () => {
    const { trackPage } = await onHost('scan.thru.org');
    trackPage('explorer', '/block/1');
    trackPage('explorer', '/block/2');
    trackPage('explorer', '/');
    expect(fathom.load).toHaveBeenCalledExactlyOnceWith('HVJDZCHH', { auto: false });
    expect(fathom.trackPageview.mock.calls).toEqual([
      [{ url: '/block/:number' }], [{ url: '/block/:number' }], [{ url: '/' }],
    ]);
  });

  it('skips a repeat of the same path', async () => {
    const { trackPage } = await onHost('scan.thru.org');
    trackPage('explorer', `/address/${ADDRESS}`);
    trackPage('explorer', `/address/${ADDRESS}`);
    expect(fathom.trackPageview).toHaveBeenCalledExactlyOnceWith({ url: '/address/:address' });
  });

  it('skips a path the template rejects', async () => {
    const { trackPage } = await onHost('faucet.thru.org');
    trackPage('faucet', '/rewritten', () => null);
    expect(fathom.load).not.toHaveBeenCalled();
    expect(fathom.trackPageview).not.toHaveBeenCalled();
  });

  it('skips a page whose URL carries free text Fathom would collect', async () => {
    const { trackPage } = await onHost('scan.thru.org', `?q=${ADDRESS}`);
    trackPage('explorer', '/error');
    expect(fathom.load).not.toHaveBeenCalled();
    expect(fathom.trackPageview).not.toHaveBeenCalled();
  });

  it('still tracks campaign and referral parameters', async () => {
    const { trackPage } = await onHost('dev.thru.org', '?ref=cli&utm_source=docs');
    trackPage('platform', '/keys');
    expect(fathom.trackPageview).toHaveBeenCalledExactlyOnceWith({ url: '/keys' });
  });

  it('tracks nothing off the prod hosts', async () => {
    const { trackPage } = await onHost('faucet.staging.web.5f1.net');
    trackPage('faucet', '/');
    expect(fathom.load).not.toHaveBeenCalled();
  });
});
