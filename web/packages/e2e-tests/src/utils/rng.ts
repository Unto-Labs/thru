/**
 * SeededRNG is a deterministic random number generator for reproducible tests.
 * Uses a simple Linear Congruential Generator (LCG) algorithm.
 */
export class SeededRNG {
  private state: bigint;

  // LCG constants (same as glibc)
  private static readonly A = 1103515245n;
  private static readonly C = 12345n;
  private static readonly M = 2147483648n; // 2^31

  constructor(seed: bigint) {
    this.state = seed & 0xffffffffn;
  }

  /**
   * Generate a random 32-bit integer
   */
  next(): number {
    this.state = (SeededRNG.A * this.state + SeededRNG.C) % SeededRNG.M;
    return Number(this.state);
  }

  /**
   * Generate a random integer in [0, n)
   */
  intn(n: number): number {
    if (n <= 0) throw new Error("n must be positive");
    return this.next() % n;
  }

  /**
   * Generate a random bigint in [0, n)
   */
  int63n(n: bigint): bigint {
    if (n <= 0n) throw new Error("n must be positive");
    // Generate two 32-bit values and combine them
    const high = BigInt(this.next());
    const low = BigInt(this.next());
    const value = ((high << 31n) | low) & 0x7fffffffffffffffn;
    return value % n;
  }

  /**
   * Fill a buffer with random bytes
   */
  read(buffer: Uint8Array): void {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = this.intn(256);
    }
  }

  /**
   * Generate random bytes
   */
  bytes(length: number): Uint8Array {
    const result = new Uint8Array(length);
    this.read(result);
    return result;
  }
}

/**
 * Generate random hex string
 */
export function randomHexBytes(rng: SeededRNG, length: number): string {
  const bytes = rng.bytes(length);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
