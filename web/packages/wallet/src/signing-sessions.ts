import type {
  ThruSigningSessionCreateOptions,
  ThruSigningSessionDescriptor,
  ThruSigningSessionTimestamp,
} from "./interfaces";
import {
  getDefaultBrowserWalletSDKStorage,
  resolveWalletSDKStorageKey,
  withWalletSDKStorageErrors,
  WalletSDKStorageError,
  type WalletSDKStorage,
} from "./storage";
import type { TelemetryClient } from "./telemetry";

/** @deprecated Use WalletSDKStorage. */
export type SigningSessionStorage = WalletSDKStorage;

interface SigningSessionStorePayload {
  version: 1;
  sessions: ThruSigningSessionDescriptor[];
}

const STORAGE_VERSION = 1;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function resolveSigningSessionStorageKey(params: {
  walletOrigin: string;
  appOrigin: string;
  storageKey?: string;
}): string {
  return resolveWalletSDKStorageKey({ ...params, kind: "signing-sessions" });
}

/** Only this explicit wallet response permits one passkey retry. */
export function isSigningSessionUnavailable(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "SIGNING_SESSION_UNAVAILABLE"
  );
}

export function getDefaultBrowserSigningSessionStorage(): SigningSessionStorage | null {
  return getDefaultBrowserWalletSDKStorage();
}

export function normalizeExpiresAt(
  value: ThruSigningSessionTimestamp,
  label = "expiresAt",
): number {
  if (value instanceof Date) {
    const millis = value.getTime();
    if (!Number.isFinite(millis))
      throw new Error(`${label} must be a valid Date`);
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

export function assertSigningSessionWalletAccountIdx(
  walletAccountIdx: number,
): void {
  if (
    !Number.isInteger(walletAccountIdx) ||
    walletAccountIdx < 2 ||
    walletAccountIdx > 0xffff
  ) {
    throw new Error(
      "walletAccountIdx must be an account index between 2 and 65535",
    );
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

  constructor(
    storage: SigningSessionStorage,
    key: string,
    telemetry?: Pick<TelemetryClient, "record">,
  ) {
    this.storage = withWalletSDKStorageErrors(
      storage,
      "signing-sessions",
      telemetry,
    );
    this.key = key;
  }

  async list(): Promise<ThruSigningSessionDescriptor[]> {
    const scope = this.storage.networkScope?.();
    const sessions = await this.read();
    this.assertScope(scope);
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

  async getActive(
    walletAddress?: string,
  ): Promise<ThruSigningSessionDescriptor | null> {
    const sessions = await this.list();
    return (
      sessions
        .filter(
          (session) =>
            !walletAddress || session.walletAddress === walletAddress,
        )
        .sort((a, b) => b.expiresAt - a.expiresAt)[0] ?? null
    );
  }

  async save(descriptor: ThruSigningSessionDescriptor): Promise<void> {
    const normalized = normalizeDescriptor(descriptor);
    const scope = this.storage.networkScope?.();
    const sessions = (await this.list()).filter(
      (session) => session.id !== normalized.id,
    );
    this.assertScope(scope);
    sessions.push(normalized);
    await this.write(sessions);
  }

  async saveReplacingWalletSessions(
    descriptor: ThruSigningSessionDescriptor,
  ): Promise<void> {
    const normalized = normalizeDescriptor(descriptor);
    const scope = this.storage.networkScope?.();
    const sessions = (await this.list()).filter(
      (session) =>
        session.id === normalized.id ||
        session.walletAddress !== normalized.walletAddress,
    );
    this.assertScope(scope);
    const withoutCurrent = sessions.filter(
      (session) => session.id !== normalized.id,
    );
    withoutCurrent.push(normalized);
    await this.write(withoutCurrent);
  }

  async remove(id: string): Promise<void> {
    const scope = this.storage.networkScope?.();
    const sessions = (await this.list()).filter((session) => session.id !== id);
    this.assertScope(scope);
    if (sessions.length === 0) {
      await this.storage.removeItem(this.key);
      return;
    }
    await this.write(sessions);
  }

  async clear(): Promise<void> {
    await this.storage.removeItem(this.key);
  }

  private assertScope(scope?: string): void {
    if (scope !== this.storage.networkScope?.())
      throw Object.assign(new Error("Wallet network changed; reconnect."), {
        code: "NETWORK_CHANGED",
      });
  }
  private async read(): Promise<ThruSigningSessionDescriptor[]> {
    const scope = this.storage.networkScope?.();
    const raw = await this.storage.getItem(this.key);
    this.assertScope(scope);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as Partial<SigningSessionStorePayload>;
      if (
        parsed.version !== STORAGE_VERSION ||
        !Array.isArray(parsed.sessions)
      ) {
        await this.storage.removeItem(this.key);
        return [];
      }
      return parsed.sessions.map(normalizeDescriptor);
    } catch (error) {
      if (error instanceof WalletSDKStorageError) throw error;
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
