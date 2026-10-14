/* Mirrors programs/c/examples/tn_ratelimit_program.h. */

/* The other instructions are tagged by the generated builder. */
export const RATELIMIT_INSTRUCTION_CALL = 4;

export const RATELIMIT_ERRORS = Object.freeze({
  INVALID_INSTRUCTION: 0x5201n,
  INVALID_ACCOUNT: 0x5202n,
  INVALID_CONFIG: 0x5203n,
  UNAUTHORIZED: 0x5204n,
  CREATE_FAILED: 0x5205n,
  WRITE_FAILED: 0x5206n,
  PAUSED: 0x5207n,
  TARGET_MISMATCH: 0x5208n,
  INSTRUCTION_REJECTED: 0x5209n,
  AMOUNT_PER_CALL_EXCEEDED: 0x520an,
  BUCKET_MISMATCH: 0x520bn,
  ATTESTER_REQUIRED: 0x520cn,
  CALL_LIMIT_EXCEEDED: 0x520dn,
  AMOUNT_LIMIT_EXCEEDED: 0x520en,
  TARGET_FAILED: 0x520fn,
  /* Reverted by gated targets (tn_ratelimit_gate.h). */
  GATE_NOT_RATE_LIMITED: 0x52a1n,
} as const);

export const RATELIMIT_POLICY_MAGIC = 0x7261746c706f6c31n; /* "ratlpol1" */
export const RATELIMIT_BUCKET_MAGIC = 0x7261746c62636b31n; /* "ratlbck1" */

export const RATELIMIT_RULE_MAX = 4;
export const RATELIMIT_CONSTRAINT_MAX = 4;
export const RATELIMIT_NO_ACCOUNT = 0xffff;

export const RATELIMIT_POLICY_FLAG_PAUSED = 0x01;
export const RATELIMIT_POLICY_FLAG_VERIFIED = 0x80;

export const RATELIMIT_KEY_GLOBAL = 0;
export const RATELIMIT_KEY_FEE_PAYER = 1;
export const RATELIMIT_KEY_INSTR_ACCOUNT = 2;
export const RATELIMIT_KEY_ATTESTED = 3;

export const RATELIMIT_CLOCK_SLOT = 0;
export const RATELIMIT_CLOCK_UNIX_SECONDS = 1;

/* Packed wire sizes. */
export const RATELIMIT_CONFIG_SIZE = 309;
export const RATELIMIT_POLICY_SIZE = 390;
export const RATELIMIT_BUCKET_SIZE = 113;
export const RATELIMIT_CALL_ARGS_SIZE = 8;
export const RATELIMIT_CALL_BUCKET_SIZE = 36;
