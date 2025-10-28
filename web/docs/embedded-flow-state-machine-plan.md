# Embedded Flow State Machine Migration

Purpose: converge the embedded connection/unlock/transaction flows on a single reducer-driven state machine so transitions stay explicit, illegal states are unrepresentable, and future flows (queueing, retries, shared worker) can be layered on without duplicating state bookkeeping.

---

## Phase 0 – Discovery & Alignment

**Goal:** Capture the current surface area and invariants before introducing the reducer so we can reproduce every behaviour.

**Deliverables**
- Inventory of state fields + setters across `useConnectionFlow`, `useUnlockFlow`, `useTransactionFlow`, and `EmbeddedFlowContext`.
- Transition matrix describing how each message/event mutates state today (connect, auto-approve, unlock failure, auto-lock, disconnect, multi-request).
- Agreement on reducer scope (what stays local form state vs. goes into shared store).

**Tasks**
- Read through the three flow hooks and `EmbeddedFlowContext` to list every `useState` call, default value, and setter usage (including indirect mutations via helpers).
- Map each message handler (`useEmbeddedMessageHandlers`) to the sequence of setter calls it triggers; flag transitions that skip resets or rely on implicit defaults.
- Document external side effects that depend on state (storage writes, `sendEvent`, `sendResponse`) and when they fire relative to state updates.
- Share a short summary doc/PR comment and align with stakeholders on which state should move into the reducer vs. remain local (e.g., unlock password).

**Implementation Notes**
- Lean on existing console logs and comments to confirm intent before refactoring.
- Capture any known bugs or TODOs so they can be regression-tested once the reducer lands.

**Validation**
- Walk through the embedded page manually (connect, reject, disconnect, unlock) and confirm the captured transition list matches observed behaviour.

---

## Phase 1 – State & Event Model

**Goal:** Define the discriminated unions for reducer state and events with enough fidelity to model the existing flows.

**Deliverables**
- `EmbeddedFlowState` union covering idle, pending approval, unlocking, signing, error, and locked scenarios.
- `EmbeddedFlowEvent` union representing inbound messages, user actions, and system events (auto-lock, refresh success, etc.).
- Type guards or helper enums where useful for narrowing.

**Tasks**
- Draft TypeScript interfaces/enums for states and events in a new `embedded/state` module.
- Model modal visibility (`modalType`) as derived state rather than a separate field where possible; note any cases that require explicit modal overrides.
- Encode metadata, pending request payload, loading/error flags inside the state union so they cannot get out of sync.
- Circulate the type definitions for feedback; revise until all consumers agree the model covers current and near-term needs.

**Implementation Notes**
- Prefer descriptive state names (`AwaitingConnectApproval`, `AwaitingUnlock`, `TransactionApproval`) to avoid overloading boolean flags.
- Keep events granular (`CONNECT_MESSAGE_RECEIVED`, `UNLOCK_SUBMITTED`, `SIGN_REQUEST_FAILED`) so logging and analytics can hook in.

**Validation**
- Build a lightweight transition table (state + event → next state) in comments or markdown; ensure every existing flow maps to at least one path.

---

## Phase 2 – Reducer & Store Foundation

**Goal:** Implement the reducer, action creators, and a `useEmbeddedFlowStore` hook without wiring it into the UI yet.

**Deliverables**
- `embedded/state/reducer.ts` exporting `embeddedFlowReducer`, `initialEmbeddedFlowState`, and action creator helpers.
- Type-safe `dispatchEmbeddedEvent(...)` utilities that wrap raw event objects.
- Unit tests covering happy/error-path transitions.

**Tasks**
- Translate the transition table into an exhaustive `switch` reducer; throw/log on unsupported transitions to catch regressions.
- Create action helpers (`connectReceived`, `unlockSucceeded`, `autoLockDetected`, etc.) to avoid hand-crafting event payloads across the app.
- Implement selectors (e.g., `selectModal`, `selectPendingRequest`) for common derived data so components/hooks stay declarative.
- Add Jest/Vitest tests asserting next state and emitted side effects (derived flags) for every major path; include failure cases (invalid transition).
- Document reducer usage and conventions in `docs/` (tie back to this plan).

**Implementation Notes**
- Keep reducer pure: have callers perform side effects (responses/events) after dispatching, or return effect descriptors if needed.
- Ensure state resets (e.g., `pendingRequest`, `appMetadata`) happen in one place inside the reducer rather than scattered.

**Validation**
- Run test suite (`pnpm test --filter embedded-flow` once available) and ensure new reducer tests cover >90% of branches.

---

## Phase 3 – Connection Flow Migration

**Goal:** Move `useConnectionFlow` onto the reducer while preserving its public API for downstream consumers.

**Deliverables**
- `useEmbeddedFlowStore` hook instantiated inside `EmbeddedFlowProvider` (or a new provider) and passed into `useConnectionFlow`.
- `useConnectionFlow` rewritten to select data from the shared store and dispatch events instead of mutating local state.
- Compatibility layer that keeps existing `connection.actions.*` methods working (internally dispatching reducer events).

**Tasks**
- Introduce the store provider (`EmbeddedFlowStoreProvider`) and wire it into `EmbeddedFlowContext`; keep old context shape stable for now.
- Replace local `useState` hooks in `useConnectionFlow` with selectors tied to the store; remove redundant state once selectors exist.
- Update connection handlers (`handleConnect`, `approveConnection`, `handleReject`, etc.) to dispatch reducer events and handle asynchronous side effects (responses, storage writes) after state transitions.
- Maintain method signatures (`approveConnection(options)`, `handleDisconnect`) so message handlers and other hooks compile unchanged.
- Add targeted tests (or story/fixture) to confirm connect + auto-approve still succeeds using the new store.

**Implementation Notes**
- Co-locate side-effect helpers (e.g., storage writes) in small utilities so the reducer-focused code stays readable.
- Keep logging intact; consider logging both event and resulting state for early debugging.

**Validation**
- Manual regression: connect, auto-approve path, reject connect, disconnect.
- Ensure no React warnings about state updates on unmounted components (watch for stale dispatchers).

---

## Phase 4 – Unlock & Transaction Flow Migration

**Goal:** Migrate `useUnlockFlow` and `useTransactionFlow` to the shared store while keeping form state (password input) local.

**Deliverables**
- Hooks retrieving shared state via selectors and dispatching reducer events for unlock/transaction transitions.
- Updated action helpers for unlock success/failure and transaction approval/rejection.
- Updated tests covering unlock failure, unlock → connect success, transaction approval, and transaction failure branches.

**Tasks**
- Refactor unlock hook to emit `UNLOCK_SUBMITTED`, `UNLOCK_SUCCEEDED`, `UNLOCK_FAILED`, and let the reducer determine next modal state.
- Move transaction hook logic to dispatch `SIGN_REQUEST_RECEIVED`, `SIGN_APPROVED`, `SIGN_FAILED` events and rely on reducer for state resets.
- Ensure unlock hook clears password locally on success/failure without touching shared state directly.
- Update `useEmbeddedMessageHandlers` to call the new action creators instead of setting pending request/app metadata manually.
- Expand reducer tests for unlock and transaction events; add hook-level tests if practical.

**Implementation Notes**
- Double-check that failure paths in unlock/transaction dispatch both the reducer event and `sendResponse` with the correct error code.
- Keep derived flags like `isLoading` centralized; hooks should read from selectors rather than manage their own.

**Validation**
- Manual regression for unlock-required connect, incorrect password, transaction approval, transaction rejection.
- Confirm that auto-lock while unlock modal is open still routes through the reducer correctly.

---

## Phase 5 – Context & Router Consolidation

**Goal:** Simplify `EmbeddedFlowContext`, auto-lock handling, and message routing now that all flows share the reducer.

**Deliverables**
- `EmbeddedFlowContext` providing store state and bound action creators instead of ad-hoc setters.
- Auto-lock effect replaced with a single reducer event (`AUTO_LOCK_TRIGGERED`).
- Message router/handlers cleaned up to dispatch succinct events (`connectReceived`, `disconnectRequested`) and rely on reducer-driven state.

**Tasks**
- Remove leftover setter destructuring in `EmbeddedFlowContext`; expose selectors/actions from the store via context.
- Replace the auto-lock `useEffect` cascade with one dispatch; move response/event side effects adjacent for clarity.
- Simplify `useEmbeddedMessageHandlers` to focus on request validation + dispatch; drop redundant state resets now handled in reducer.
- Audit components (`ConnectModal`, `UnlockModal`, `TransactionApprovalModal`, `IdleState`) to ensure they only consume derived state props from context.
- Update any tests or stories that relied on the old context shape.

**Implementation Notes**
- Provide a typed interface for consumers (`useEmbeddedFlowContext`) so future additions stay constrained.
- Keep a compatibility shim or release note if context consumers outside this repo exist.

**Validation**
- Run through full end-to-end flow inside the iframe and `test-dapp`; confirm postMessage handshake still succeeds.
- Monitor console for missing event warnings or unknown reducer transitions.

---

## Phase 6 – QA, Documentation, and Cleanup

**Goal:** Lock in quality, update docs, and remove temporary compatibility layers.

**Deliverables**
- Updated developer docs describing the reducer architecture (link back to this plan).
- Comprehensive test plan results (manual + automated) captured in `EVENT_FLOW_AUDIT.md` or a new QA note.
- Removed deprecated helpers/setters and dead code uncovered during migration.

**Tasks**
- Expand automated coverage where gaps remain (hook tests, reducer edge cases, integration smoke test if feasible).
- Run the embedded iframe against supported browsers/environments; note any behavioural changes.
- Update `embedded-flow-diagram.md` (or produce a new diagram) to reflect reducer states/events.
- Clean up temporary compatibility exports once downstream consumers are migrated.
- Announce the change in release notes/Slack with guidance for SDK integrators.

**Implementation Notes**
- Coordinate with QA/PM on rollout timing; consider feature flags if we need a soft launch.
- Schedule a post-mortem or retro after rollout to capture lessons for future state-machine refactors.

**Validation**
- Sign-off from stakeholders (engineering + product) after reviewing QA outcomes.
- Monitor production metrics/logs post-release for regressions.

---

## Rollout Checklist

- [] Complete Phase 0 inventory and review with stakeholders.
- [] Socialize state/event model (Phase 1) and secure approval before coding.
- [] Land reducer foundation with passing tests (Phase 2).
- [] Ship connection migration behind a guarded release if needed (Phase 3).
- [] Roll unlock/transaction changes once connection flow proves stable (Phase 4).
- [] Update context/router and remove old setters (Phase 5).
- [] Finalize documentation, tests, and comms (Phase 6).
