export type AbiErrorCode = "PARSE_ERROR" | "VALIDATION_ERROR" | "DECODE_ERROR";

export class AbiError extends Error {
  readonly code: AbiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AbiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = this.constructor.name;
  }
}

export class AbiParseError extends AbiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PARSE_ERROR", message, details);
  }
}

export class AbiValidationError extends AbiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, details);
  }
}

export class AbiDecodeError extends AbiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("DECODE_ERROR", message, details);
  }
}

