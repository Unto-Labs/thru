// Program pubkeys
export const EOA_PROGRAM = new Uint8Array(32); // All zeros

export const SYSTEM_PROGRAM = (() => {
  const pk = new Uint8Array(32);
  pk[31] = 0x01;
  return pk;
})();

export const NOOP_PROGRAM = (() => {
  const pk = new Uint8Array(32);
  pk[31] = 0x03;
  return pk;
})();

// Test uploader program - supports CREATE/WRITE/RESIZE/FINALIZE for testing
export const TEST_UPLOADER_PROGRAM = (() => {
  const pk = new Uint8Array(32);
  pk[31] = 0xdd;
  return pk;
})();

// Uploader program (real uploader) - supports CREATE/WRITE/FINALIZE/DESTROY
export const UPLOADER_PROGRAM = (() => {
  const pk = new Uint8Array(32);
  pk[31] = 0x02;
  return pk;
})();

export const MANAGER_PROGRAM = (() => {
  const pk = new Uint8Array(32);
  pk[31] = 0x04;
  return pk;
})();

export const EVENT_PROGRAM = (() => {
  const pk = new Uint8Array(32);
  pk[31] = 0xff;
  return pk;
})();

// Common transaction constants
export const DEFAULT_FEE = 1n;
export const DEFAULT_CU = 1_000_000;
export const DEFAULT_SU = 10_000;
export const DEFAULT_MU = 10_000;
export const DEFAULT_EXPIRY = 1_000_000;
