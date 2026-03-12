export const U64_MAX = 18_446_744_073_709_551_615n;

export function assertU64Amount(input: bigint, fieldName: string): bigint {
  if (input < 0n) {
    throw new Error(`${fieldName} must be >= 0`);
  }
  if (input > U64_MAX) {
    throw new Error(`${fieldName} overflows u64`);
  }
  return input;
}
