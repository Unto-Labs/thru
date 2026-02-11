import { getUnifiedDB } from './db';
import { StoreName } from './schema';
import type { PasskeyProfileRecord, PasskeyStoreSettings } from './types';

const CURRENT_PROFILE_VERSION = 1;
const SETTINGS_KEY = 'settings';

export interface PasskeyMetadata {
  credentialId: string;
  publicKeyX: string;
  publicKeyY: string;
  rpId: string;
  label?: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface PasskeyProfile {
  id: string;
  label: string;
  passkey: PasskeyMetadata | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PasskeyProfileStore {
  profiles: PasskeyProfile[];
  selectedIndex: number;
}

/**
 * Load all passkey profiles and settings from IndexedDB.
 * Returns null if no profiles exist or if the DB is unavailable.
 */
export async function loadPasskeyProfiles(): Promise<PasskeyProfileStore | null> {
  if (typeof window === 'undefined') return null;

  try {
    const db = await getUnifiedDB();
    const allRecords = await db.getAll(StoreName.PASSKEY_PROFILES);

    let settings: PasskeyStoreSettings | null = null;
    const profiles: PasskeyProfile[] = [];

    for (const record of allRecords) {
      if (record.id === SETTINGS_KEY) {
        settings = record as PasskeyStoreSettings;
      } else if (record.id) {
        profiles.push(record as PasskeyProfile);
      }
    }

    if (profiles.length === 0) return null;

    // Run schema migration if needed
    if (settings && settings.version < CURRENT_PROFILE_VERSION) {
      migrateProfiles(profiles, settings.version);
      settings = { ...settings, version: CURRENT_PROFILE_VERSION };
      await db.put(StoreName.PASSKEY_PROFILES, settings);
    }

    return {
      profiles,
      selectedIndex: settings?.selectedIndex ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Save all passkey profiles and settings to IndexedDB.
 * Returns true on success, false on failure.
 */
export async function savePasskeyProfiles(store: PasskeyProfileStore): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const db = await getUnifiedDB();
    const tx = db.transaction(StoreName.PASSKEY_PROFILES, 'readwrite');

    // Clear all existing records
    await tx.store.clear();

    // Write profiles
    for (const profile of store.profiles) {
      await tx.store.put(profile as PasskeyProfileRecord);
    }

    // Write settings
    const settings: PasskeyStoreSettings = {
      id: SETTINGS_KEY,
      selectedIndex: store.selectedIndex,
      version: CURRENT_PROFILE_VERSION,
    };
    await tx.store.put(settings);

    await tx.done;
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a default profile store with one empty profile.
 */
export function createDefaultProfileStore(): PasskeyProfileStore {
  const now = new Date().toISOString();
  const profileId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : String(Date.now());

  return {
    profiles: [
      {
        id: profileId,
        label: 'Default Profile',
        passkey: null,
        createdAt: now,
        lastUsedAt: null,
      },
    ],
    selectedIndex: 0,
  };
}

/**
 * Update a profile's passkey metadata (pure in-memory transform).
 */
export function updateProfilePasskey(
  store: PasskeyProfileStore,
  profileIndex: number,
  passkey: PasskeyMetadata
): PasskeyProfileStore {
  const updatedProfiles = [...store.profiles];
  const current = updatedProfiles[profileIndex];
  if (!current) {
    return store;
  }

  updatedProfiles[profileIndex] = {
    ...current,
    passkey,
    lastUsedAt: passkey.lastUsedAt,
  };

  return {
    ...store,
    profiles: updatedProfiles,
  };
}

/**
 * Update lastUsedAt timestamp for a profile's passkey (pure in-memory transform).
 */
export function updatePasskeyLastUsed(
  store: PasskeyProfileStore,
  profileIndex: number
): PasskeyProfileStore {
  const updatedProfiles = [...store.profiles];
  const current = updatedProfiles[profileIndex];
  if (!current?.passkey) {
    return store;
  }

  const now = new Date().toISOString();
  updatedProfiles[profileIndex] = {
    ...current,
    passkey: {
      ...current.passkey,
      lastUsedAt: now,
    },
    lastUsedAt: now,
  };

  return {
    ...store,
    profiles: updatedProfiles,
  };
}

/**
 * Migrate profile data from an older schema version to current.
 * Mutates profiles in-place for efficiency.
 */
function migrateProfiles(_profiles: PasskeyProfile[], _fromVersion: number): void {
  // Currently at version 1, no migrations needed yet.
  // Future migrations would go here:
  // if (fromVersion < 2) { ... }
}
