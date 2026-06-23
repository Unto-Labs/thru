export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function uniqueAccounts(accounts: Uint8Array[]): Uint8Array[] {
  const unique: Uint8Array[] = [];
  for (const account of accounts) {
    if (!unique.some((candidate) => bytesEqual(candidate, account))) {
      unique.push(account);
    }
  }
  return unique;
}
