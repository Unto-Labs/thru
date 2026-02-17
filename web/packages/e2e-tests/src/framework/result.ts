export interface TestResult {
  /** Whether the test passed */
  success: boolean;

  /** Summary message describing the test result */
  message: string;

  /** Detailed steps or information about the test execution */
  details: string[];

  /** Detailed verification steps showing what was validated */
  verificationDetails: string[];

  /** Time taken to execute the test in milliseconds */
  executionTimeMs: number;
}

export function makeSuccessResult(message: string, details: string[] = []): TestResult {
  return {
    success: true,
    message,
    details,
    verificationDetails: [],
    executionTimeMs: 0,
  };
}

export function makeErrorResult(message: string, error?: Error | null): TestResult {
  const details: string[] = [];
  if (error) {
    details.push(error.message);
  }
  return {
    success: false,
    message,
    details,
    verificationDetails: [],
    executionTimeMs: 0,
  };
}
