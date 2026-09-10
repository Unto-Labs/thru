/** Mirrors Expo SecureStore's key restrictions, including the nonempty check. */
export class SecureStoreTestStorage {
  readonly values = new Map<string, string>();
  private validate(key: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(key))
      throw new Error("Invalid SecureStore key");
  }
  getItem(key: string): string | null {
    this.validate(key);
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.validate(key);
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.validate(key);
    this.values.delete(key);
  }
}
