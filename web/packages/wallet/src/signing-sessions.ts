import type {
  ThruSigningSessionCreateOptions,
  ThruSigningSessionDescriptor,
  ThruSigningSessionTimestamp,
} from "./interfaces";

export interface SigningSessionStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

interface SigningSessionStorePayload {
  version: 1;
  sessions: ThruSigningSessionDescriptor[];
}

const STORAGE_VERSION = 1;
const KEY_PREFIX = "thru.wallet.signing-sessions.v1";

function encodeKeyPart(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function resolveSigningSessionStorageKey(params: {
  walletOrigin: string;
  appOrigin: string;
  storageKey?: string;
}): string {
  if (params.storageKey) return params.storageKey;
  return `${KEY_PREFIX}:${encodeKeyPart(params.walletOrigin)}:${encodeKeyPart(params.appOrigin)}`;
}

export function getDefaultBrowserSigningSessionStorage(): SigningSessionStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function normalizeExpiresAt(
  value: ThruSigningSessionTimestamp,
  label = "expiresAt",
): number {
  if (value instanceof Date) {
    const millis = value.getTime();
    if (!Number.isFinite(millis)) throw new Error(`${label} must be a valid Date`);
    return Math.floor(millis / 1000);
  }

  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${label} must fit in a JavaScript safe integer`);
    }
    return Number(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`${label} must be a Unix timestamp in seconds`);
    }
    return normalizeExpiresAt(BigInt(trimmed), label);
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite positive Unix timestamp`);
  }
  return Math.floor(value);
}

export function resolveSessionExpirySeconds(
  options: ThruSigningSessionCreateOptions,
): number {
  const hasDuration = options.durationSeconds !== undefined;
  const hasExpiresAt = options.expiresAt !== undefined;
  if (hasDuration === hasExpiresAt) {
    throw new Error("Provide exactly one of durationSeconds or expiresAt");
  }

  if (hasDuration) {
    const duration = options.durationSeconds;
    if (
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error("durationSeconds must be a positive number");
    }
    return nowSeconds() + Math.floor(duration);
  }

  return normalizeExpiresAt(options.expiresAt!, "expiresAt");
}

export function assertSigningSessionWalletAccountIdx(walletAccountIdx: number): void {
  if (!Number.isInteger(walletAccountIdx) || walletAccountIdx < 2 || walletAccountIdx > 0xffff) {
    throw new Error("walletAccountIdx must be an account index between 2 and 65535");
  }
}

function normalizeDescriptor(
  descriptor: ThruSigningSessionDescriptor,
): ThruSigningSessionDescriptor {
  return {
    id: descriptor.id,
    walletAddress: descriptor.walletAddress,
    publicKey: descriptor.publicKey,
    authIdx: Number(descriptor.authIdx),
    expiresAt: normalizeExpiresAt(descriptor.expiresAt, "descriptor.expiresAt"),
    createdAt: normalizeExpiresAt(descriptor.createdAt, "descriptor.createdAt"),
  };
}

function isActive(descriptor: ThruSigningSessionDescriptor): boolean {
  return nowSeconds() < descriptor.expiresAt;
}

export class SigningSessionDescriptorStore {
  private readonly storage: SigningSessionStorage;
  private readonly key: string;

  constructor(storage: SigningSessionStorage, key: string) {
    this.storage = storage;
    this.key = key;
  }

  async list(): Promise<ThruSigningSessionDescriptor[]> {
    const sessions = await this.read();
    const active = sessions.filter(isActive);
    if (active.length !== sessions.length) {
      await this.write(active);
    }
    return active;
  }

  async get(id: string): Promise<ThruSigningSessionDescriptor | null> {
    const sessions = await this.list();
    return sessions.find((session) => session.id === id) ?? null;
  }

  async save(descriptor: ThruSigningSessionDescriptor): Promise<void> {
    const normalized = normalizeDescriptor(descriptor);
    const sessions = (await this.list()).filter((session) => session.id !== normalized.id);
    sessions.push(normalized);
    await this.write(sessions);
  }

  async saveReplacingWalletSessions(
    descriptor: ThruSigningSessionDescriptor,
  ): Promise<void> {
    const normalized = normalizeDescriptor(descriptor);
    const sessions = (await this.list()).filter(
      (session) =>
        session.id === normalized.id ||
        session.walletAddress !== normalized.walletAddress,
    );
    const withoutCurrent = sessions.filter((session) => session.id !== normalized.id);
    withoutCurrent.push(normalized);
    await this.write(withoutCurrent);
  }

  async remove(id: string): Promise<void> {
    const sessions = (await this.list()).filter((session) => session.id !== id);
    if (sessions.length === 0) {
      await this.storage.removeItem(this.key);
      return;
    }
    await this.write(sessions);
  }

  private async read(): Promise<ThruSigningSessionDescriptor[]> {
    const raw = await this.storage.getItem(this.key);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as Partial<SigningSessionStorePayload>;
      if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.sessions)) {
        await this.storage.removeItem(this.key);
        return [];
      }
      return parsed.sessions.map(normalizeDescriptor);
    } catch {
      await this.storage.removeItem(this.key);
      return [];
    }
  }

  private async write(sessions: ThruSigningSessionDescriptor[]): Promise<void> {
    const payload: SigningSessionStorePayload = {
      version: STORAGE_VERSION,
      sessions: sessions.map(normalizeDescriptor),
    };
    await this.storage.setItem(this.key, JSON.stringify(payload));
  }
}
