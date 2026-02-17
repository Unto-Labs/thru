/**
 * Account Shrink Bug (COW Pages) Scenario
 *
 * This is an alias for AccountResizeScenario with a different name.
 * Both tests verify the same COW pages bug fix when shrinking accounts
 * in the same slot as creation/growth.
 */

import { AccountResizeScenario } from "./account-resize";

export class AccountShrinkBugScenario extends AccountResizeScenario {
  name = "Account Shrink Bug (COW Pages)";
  description =
    "Tests that shrinking an account in the same slot as creation/growth properly allocates COW pages";
}

export function createAccountShrinkBugScenario(): AccountShrinkBugScenario {
  return new AccountShrinkBugScenario();
}
