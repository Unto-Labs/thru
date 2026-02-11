import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, initializeSchema } from './schema';

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * Returns the shared unified database connection.
 */
export function getUnifiedDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        initializeSchema(db as unknown as IDBDatabase);
      },
    });
  }
  return dbPromise;
}
