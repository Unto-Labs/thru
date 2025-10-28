import type { AppMetadata, ConnectMetadataInput } from '@thru/protocol';

const DEFAULT_APP_NAME = 'A dApp';

export function resolveAppMetadata(origin: string, metadata?: ConnectMetadataInput): AppMetadata {
  const trustedOrigin = origin;
  const originUrl = safeParseUrl(trustedOrigin);

  const appUrl = resolveAppUrl(trustedOrigin, metadata?.appUrl);
  const appName = metadata?.appName || originUrl?.hostname || DEFAULT_APP_NAME;
  const imageUrl = sanitizeImageUrl(metadata?.imageUrl);

  return {
    appId: trustedOrigin,
    appName,
    appUrl,
    imageUrl,
  };
}

export function getDisplayAppName(metadata?: AppMetadata, fallbackOrigin?: string): string {
  if (metadata?.appName) {
    return metadata.appName;
  }

  if (fallbackOrigin) {
    const parsed = safeParseUrl(fallbackOrigin);
    if (parsed?.hostname) {
      return parsed.hostname;
    }
    return fallbackOrigin;
  }

  return DEFAULT_APP_NAME;
}

export function getDisplayAppUrl(metadata?: AppMetadata, fallbackOrigin?: string): string | undefined {
  if (metadata?.appUrl) {
    return metadata.appUrl;
  }
  return fallbackOrigin;
}

export function truncatePublicKey(publicKey: string, visibleChars: number = 8): string {
  if (!publicKey) {
    return '';
  }

  return publicKey.slice(0, visibleChars);
}

export function sanitizeImageUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function resolveAppUrl(origin: string, providedUrl?: string): string {
  if (providedUrl) {
    const parsedProvided = safeParseUrl(providedUrl);
    if (parsedProvided) {
      if (parsedProvided.origin === origin) {
        return parsedProvided.toString();
      }
      if (parsedProvided.protocol === 'https:') {
        return parsedProvided.toString();
      }
    }
  }

  return origin;
}

function safeParseUrl(value?: string): URL | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
