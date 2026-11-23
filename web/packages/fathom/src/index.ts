import { load, trackPageview } from 'fathom-client';

/* Public Fathom site IDs. They ship in client HTML, so they are safe to
   commit. Each app reports to its own site, and only from its prod hosts:
   prod promotes the staging image, so the choice is made at runtime. An app
   served under a thru.org path prefix (thru.org/scan) reports to its own site,
   so its paths never mix with thru-web's. thru-web, the docs and untolabs.com
   load Fathom themselves. The wallets send nothing. */
export const FATHOM_SITES = {
  explorer: { siteId: 'HVJDZCHH', hosts: ['scan.thru.org', 'thru.org', 'www.thru.org'] },
  platform: { siteId: 'KEBFLGKD', hosts: ['dev.thru.org'] },
  faucet: { siteId: 'VORLNTHK', hosts: ['faucet.thru.org'] },
  gallery: { siteId: 'BBJBLHGD', hosts: ['design.thru.org'] },
} as const satisfies Record<string, { siteId: string; hosts: readonly string[] }>;

export type FathomApp = keyof typeof FATHOM_SITES;

/* The site an app reports to on this host, or null off its prod hosts. */
export function fathomSiteId(app: FathomApp, hostname: string): string | null {
  const site = FATHOM_SITES[app];
  return (site.hosts as readonly string[]).includes(hostname) ? site.siteId : null;
}

const ADDRESS = /^ta[A-Za-z0-9_-]{44}$/;
const SIGNATURE = /^ts[A-Za-z0-9_-]{88}$/;
const NUMBER = /^\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* Hex keys and hashes, and long base58/base64 tokens such as other chains'
   addresses. Words in a route never get this long without a separator. */
const OPAQUE = /^(?:[0-9a-f]{16,}|[A-Za-z0-9_-]{32,})$/i;

/* Replaces identifiers in a path with fixed names, so pages roll up in the
   dashboard and no account, transaction or record id leaves the browser.
   Segments are matched decoded, so a percent-encoded id is still caught; one
   that does not decode is treated as an id. */
export function templatePath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean).map((raw) => {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return ':id';
    }
    if (ADDRESS.test(segment)) return ':address';
    if (SIGNATURE.test(segment)) return ':signature';
    if (NUMBER.test(segment)) return ':number';
    if (UUID.test(segment)) return ':id';
    if (OPAQUE.test(segment)) return ':id';
    return raw;
  });
  return `/${segments.join('/')}`;
}

/* Fathom's script attaches these query parameters to every pageview straight
   from window.location.search, whatever url it is given. They can hold free
   text a visitor typed (the explorer sends a failed search as `?q=`), so a page
   whose URL carries one is not tracked. `ref`, `tab`, `utm_*`, `gclid` and
   `msclkid` are also collected; they carry campaign slugs and fixed tab names,
   and are kept. */
const FREE_TEXT_QUERY_KEYS = ['keyword', 'q', 's', 'action', 'name', 'pagename', 'via'];

function hasFreeTextQuery(search: string): boolean {
  const keys = new URLSearchParams(search);
  return FREE_TEXT_QUERY_KEYS.some((key) => keys.has(key));
}

let loadedSite: string | null = null;
let lastPath: string | null = null;

/* Sends one pageview: the templated path only, never the query string or
   hash, which can carry tokens and frame ids. `template` may return null for
   a path the app rewrites, which is tracked when the real page renders.
   Repeats are skipped by the real path, so /block/1 then /block/2 are two
   visits on one dashboard row. Fathom loads with `auto: false`, so its script
   never reads the URL. */
export function trackPage(
  app: FathomApp,
  pathname: string,
  template: (pathname: string) => string | null = templatePath
): void {
  if (typeof window === 'undefined') return;
  const siteId = fathomSiteId(app, window.location.hostname);
  if (!siteId) return;
  if (pathname === lastPath || hasFreeTextQuery(window.location.search)) return;
  const path = template(pathname);
  if (path === null) return;
  if (loadedSite !== siteId) {
    load(siteId, { auto: false });
    loadedSite = siteId;
  }
  lastPath = pathname;
  trackPageview({ url: path });
}
