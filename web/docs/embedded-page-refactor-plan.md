# Embedded Page Refactor Plan

Purpose: break up `wallet/app/embedded/page.tsx` into composable, testable pieces while keeping the user experience stable. Each phase stands on its own and can ship iteratively.

---

## Phase 1 – Flow-Specific Hooks (Connection / Unlock / Transaction)

**Goal:** Isolate the primary flows from the page component so state and side effects are easier to reason about.

**Deliverables**
- `useConnectionFlow` manages pending request, metadata sanitation, approval/reject handlers, and emits events.
- `useUnlockFlow` owns password state + unlock submission, delegating back to `useConnectionFlow`.
- Optional `useTransactionApproval` handles the sign-transaction path.

**Tasks**
- [x] Create `useConnectionFlow` hook with modal/pending state and approval helpers.
- [x] Create `useUnlockFlow` hook that coordinates with the connection flow.
- [x] Create `useTransactionFlow` hook for sign/approve logic.

**Implementation Notes**
- Each hook should accept dependencies (e.g., `workerClient`, `ConnectedAppsStorage`) to keep them portable.
- Return a normalized state blob: `{ status, modalType, handlers }`.

**Validation**
- Unit test the hooks where practical (mocked storage/worker calls).
- Smoke test the iframe to ensure modal behaviour is unchanged.

---

## Phase 2 – Message Handler Wrapper (`useEmbeddedMessageHandlers`)

**Goal:** Centralize the `useEmbeddedMessageRouter` configuration in its own hook so the page just wires handlers to the router.

**Deliverables**
- `useEmbeddedMessageHandlers` consumes the flow hooks from Phase 1 and returns `{ onConnect, onDisconnect, … }`.
- The page component only imports the hook and passes the returned handlers into `useEmbeddedMessageRouter`.

**Tasks**
- [x] Create `useEmbeddedMessageHandlers` hook that encapsulates router callbacks.
- [x] Wire the embedded page through a provider/container that uses the new hook.

**Implementation Notes**
- Ensure each handler is referentially stable (`useCallback`) so the router effect doesn’t rebind unnecessarily.
- Keep logging inside the hook to retain a single source for analytics.

**Validation**
- Verify handler registration/unregistration still works by connecting/disconnecting via `test-dapp`.

---

## Phase 3 – Connected App Persistence Service

**Goal:** Pull direct `ConnectedAppsStorage` calls out of the UI layer into a reusable service.

**Deliverables**
- `embedded/services/connectedAppsManager.ts` (or similar) exposing `find`, `save`, `remove`, and `refreshMetadata`.
- Flow hooks from Phase 1 import the manager instead of talking to IndexedDB directly.

**Implementation Notes**
- Manager functions should accept the minimal data they need (accountId, metadata) and handle key composition internally.
- Add structured logging inside the manager for storage errors.

**Validation**
- Run through connect/auto-approve/remove flows and confirm IndexedDB entries update correctly (via dev tools).

---

## Phase 4 – Presentation Split (Container vs. View Components)

**Goal:** Separate stateful logic from JSX rendering so we can evolve the UI without touching business logic.

**Deliverables**
- `EmbeddedPageContainer` imports the hooks and passes derived props to a new `EmbeddedPageView`.
- Extract modal rendering into a pure component that accepts a props object (e.g., `{ modalType, modalProps }`).

**Implementation Notes**
- Keep the container file minimal: hook invocations, prop wiring, conditional component selection.
- The view component should only receive serializable props (no functions with extra closures).

**Validation**
- Storybook (optional) or snapshot tests for the view component to lock UI states.
- Manual QA to ensure all modals still render and close correctly.

---

## Phase 5 – Logging & Analytics Utilities

**Goal:** Deduplicate console/analytics instrumentation and prepare for future event capture.

**Deliverables**
- `logConnectionEvent({ stage, metadata, autoApproved })` helper.
- Replace existing `console.log`/`console.info` statements in the flow hooks with the helper.
- Optionally expose a single `emitAnalyticsEvent` hook that can be swapped for production telemetry later.

**Implementation Notes**
- Keep helpers side-effect free besides the logging/analytics call.
- Consider gating verbose logs behind a feature flag or environment check.

**Validation**
- Confirm logs still appear with accurate metadata during connect/auto-approve/unlock paths.
- Ensure no new dependencies are required for analytics integration.

---

## Rollout Checklist

1. Ship phases sequentially; monitor bundle size and behaviour after each.
2. After Phase 4, evaluate test coverage gaps and add targeted unit/integration tests.
3. Update developer docs describing the new hook/service layout.
4. Revisit Phase 5 once we have a concrete analytics pipeline (optional).
