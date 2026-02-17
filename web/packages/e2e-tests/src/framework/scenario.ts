import type { TestContext } from "./context";
import type { TestResult } from "./result";

/**
 * TestScenario represents a single e2e test scenario
 */
export interface TestScenario {
  /** Unique name of the test scenario */
  name: string;

  /** Brief description of what this test validates */
  description: string;

  /** Prepares the test environment (optional) */
  setup(ctx: TestContext): Promise<void>;

  /** Runs the actual test and returns detailed results */
  execute(ctx: TestContext): Promise<TestResult>;

  /** Cleans up resources after test execution (optional) */
  cleanup(ctx: TestContext): Promise<void>;
}

/**
 * BaseScenario provides default implementations for optional lifecycle methods
 */
export abstract class BaseScenario implements TestScenario {
  abstract name: string;
  abstract description: string;

  async setup(_ctx: TestContext): Promise<void> {
    // Default: no setup required
  }

  abstract execute(ctx: TestContext): Promise<TestResult>;

  async cleanup(_ctx: TestContext): Promise<void> {
    // Default: no cleanup required
  }
}
