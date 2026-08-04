export enum OracleProgramError {
  InvalidInstructionDataSize = 1,
  InvalidInstruction = 2,
  UnauthorizedOperation = 3,
  FeedAlreadyExists = 4,
  InvalidFeedAccount = 5,
  InvalidAccountIndex = 6,
  InvalidFeedNameLength = 7,
  InvalidFeedType = 8,
  UpdateTooStale = 9,
  FeedTypeMismatch = 10,
  InvalidBooleanValue = 11,
}

export function oracleProgramErrorFromCode(
  code: number | bigint,
): OracleProgramError | null {
  const value = typeof code === "bigint" ? Number(code) : code;
  return value >= OracleProgramError.InvalidInstructionDataSize &&
    value <= OracleProgramError.InvalidBooleanValue
    ? (value as OracleProgramError)
    : null;
}
