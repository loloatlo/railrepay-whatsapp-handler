# Phase TD-0: Technical Debt Remediation Specification

**Date**: 2026-01-24
**Workflow**: Technical Debt Remediation (TD-0 to TD-5)
**Owner**: Quinn (Orchestrator)
**Service**: whatsapp-handler

---

## Executive Summary

This document specifies the remediation plan for 4 technical debt items affecting the WhatsApp Journey Registration Flow. These items were identified during TD analysis and have been approved by the human for remediation.

**TD Items (Priority Order)**:
1. TD-WHATSAPP-038: webhook.ts Missing stateData in Handler Context (CRITICAL, 1h)
2. TD-WHATSAPP-039: No Timeout on External HTTP Calls (HIGH, 2h)
3. TD-WHATSAPP-040: State Machine Gap in Routing Flow Entry (CRITICAL, 4h)
4. TD-WHATSAPP-041: No Retry/Circuit Breaker for Serverless Cold-Starts (MEDIUM, 3h)

**Total Estimated Effort**: 10 hours

---

## TD-WHATSAPP-038: webhook.ts Missing stateData in Handler Context

### Problem Statement

The `webhook.ts` route handler retrieves FSM state via `fsmService.getState(phoneNumber)` which returns `{ state, data }`, but the `HandlerContext` passed to handlers only includes `currentState` (the state enum value), not `stateData` (the data object).

This means handlers that need state data (like `routing-suggestion.handler` which needs `journeyId`, `origin`, `destination`, etc.) cannot access it.

### Current Code (Line 170-178 in webhook.ts)

```typescript
// Build handler context
const handlerContext: HandlerContext = {
  phoneNumber,
  messageBody,
  messageSid,
  mediaUrl,
  user,
  currentState: currentState.state,  // <-- Only state enum
  correlationId,
  // <-- MISSING: stateData: currentState.data
};
```

### Root Cause

The `stateData` property was defined in the `HandlerContext` interface (line 33 in `handlers/index.ts`) but was never populated in `webhook.ts`.

### Fix Required

Add `stateData: currentState.data` to the HandlerContext at line 178.

### Files Affected

| File | Change |
|------|--------|
| `src/routes/webhook.ts` | Add `stateData: currentState.data` to HandlerContext (line ~178) |
| `tests/unit/routes/webhook.test.ts` | Add test verifying stateData is passed to handlers |

### Acceptance Criteria

- [ ] `stateData` is passed to handlers in `HandlerContext`
- [ ] Test verifies `stateData` is passed correctly
- [ ] Existing tests continue to pass

### Dependencies

None - this is a standalone fix.

---

## TD-WHATSAPP-039: No Timeout on External HTTP Calls

### Problem Statement

The `routing-suggestion.handler.ts` makes HTTP calls to the journey-matcher API using axios without a timeout configured. In a serverless environment, this could cause the handler to hang indefinitely if the downstream service is slow or unresponsive.

### Current Code (Line 78-82 in routing-suggestion.handler.ts)

```typescript
const apiResponse = await axios.get(apiUrl, {
  headers: {
    'X-Correlation-ID': ctx.correlationId,
  },
  // <-- MISSING: timeout: 15000
});
```

### Root Cause

Timeout was not specified when implementing the HTTP client call.

### Fix Required

Add `timeout: 15000` (15 seconds) to all axios calls and handle `ECONNABORTED` errors gracefully with appropriate user messaging.

### Files Affected

| File | Change |
|------|--------|
| `src/handlers/routing-suggestion.handler.ts` | Add `timeout: 15000` to axios config |
| `tests/unit/handlers/routing-suggestion.handler.test.ts` | Add test for timeout error handling |

### Acceptance Criteria

- [ ] All axios calls have `timeout: 15000` configured
- [ ] Timeout errors return user-friendly message: "The journey routing service is unavailable. Please try again later."
- [ ] Timeout errors transition to `FSMState.ERROR`
- [ ] Test verifies timeout behavior

### Dependencies

Depends on TD-WHATSAPP-038 (stateData must be available for routing-suggestion.handler tests).

---

## TD-WHATSAPP-040: State Machine Gap in Routing Flow Entry

### Problem Statement

There is a gap in the FSM state machine flow:

1. `journey-confirm.handler` (AWAITING_JOURNEY_CONFIRM) transitions directly to `AWAITING_ROUTING_CONFIRM`
2. `routing-suggestion.handler` is registered for `AWAITING_ROUTING_CONFIRM` state
3. BUT `routing-suggestion.handler` expects to be called from `AWAITING_JOURNEY_TIME` state to fetch routes

This creates a "dead end" where:
- User confirms journey (YES) -> Handler says "checking routing..." -> Transitions to AWAITING_ROUTING_CONFIRM
- Next user message goes to `routing-suggestion.handler` in `AWAITING_ROUTING_CONFIRM` state
- Handler expects YES/NO for routing confirmation, but no routes were ever fetched!

### Approved Solution: Option C - Inline Routing Check

Human has approved Option C: The `journey-confirm.handler` will call the journey-matcher API directly before responding, eliminating the state machine gap.

### Implementation Plan

1. **Modify `journey-confirm.handler`**:
   - When user confirms journey (YES), call journey-matcher API to get routes
   - If routes require interchange, include route details in response and transition to `AWAITING_ROUTING_CONFIRM`
   - If direct route (no interchange), skip routing confirmation and transition directly to `AWAITING_TICKET_UPLOAD`

2. **Keep `routing-suggestion.handler`** as-is:
   - It already handles `AWAITING_ROUTING_CONFIRM` state correctly (YES/NO responses)
   - No changes needed

### Proposed Code Flow

```
User: "YES" (confirms journey)
journey-confirm.handler:
  1. Call journey-matcher API (with timeout from TD-039)
  2. Analyze response:
     a. If error: Return error message, stay in AWAITING_JOURNEY_CONFIRM
     b. If direct route: "Great! Now upload your ticket" -> AWAITING_TICKET_UPLOAD
     c. If interchange: "Your journey requires a change at X. Confirm? YES/NO" -> AWAITING_ROUTING_CONFIRM
  3. Store route data in stateData for routing-suggestion.handler
```

### Files Affected

| File | Change |
|------|--------|
| `src/handlers/journey-confirm.handler.ts` | Add inline routing check when user confirms |
| `tests/unit/handlers/journey-confirm.handler.test.ts` | Add tests for routing API call, direct vs interchange routes |

### Acceptance Criteria

- [ ] `journey-confirm.handler` calls journey-matcher API when user confirms (YES)
- [ ] Direct routes skip routing confirmation and go to `AWAITING_TICKET_UPLOAD`
- [ ] Interchange routes present routing for confirmation and go to `AWAITING_ROUTING_CONFIRM`
- [ ] Route data is stored in `stateData` for subsequent handler
- [ ] API errors are handled gracefully with user-friendly message
- [ ] Tests cover all scenarios

### Dependencies

- Depends on TD-WHATSAPP-038 (stateData must be available)
- Depends on TD-WHATSAPP-039 (timeout must be configured)

---

## TD-WHATSAPP-041: No Retry/Circuit Breaker for Serverless Cold-Starts

### Problem Statement

External HTTP calls to Railway-hosted services (journey-matcher) may fail due to serverless cold-start latency. A single timeout could cause poor UX when the downstream service was simply waking up.

### Solution

Create a shared HTTP client utility with:
- Retry logic (3 attempts with exponential backoff)
- Circuit breaker pattern (prevent cascading failures)
- Configurable timeouts

### Implementation Plan

1. **Create `src/utils/http-client.ts`**:
   - Export `createHttpClient(config)` function
   - Config: `timeout`, `retries`, `retryDelay`, `circuitBreakerThreshold`
   - Implement retry with exponential backoff
   - Implement basic circuit breaker (open after N failures, half-open after cooldown)

2. **Update handlers to use shared client**:
   - `routing-suggestion.handler.ts`: Replace direct axios calls
   - `journey-confirm.handler.ts`: Use for routing check (from TD-040)

### Proposed API

```typescript
interface HttpClientConfig {
  timeout: number;        // Default: 15000
  retries: number;        // Default: 3
  retryDelay: number;     // Default: 1000 (exponential backoff applied)
  circuitBreakerThreshold: number; // Default: 5 failures
  circuitBreakerCooldown: number;  // Default: 30000ms
}

export function createHttpClient(config?: Partial<HttpClientConfig>): {
  get<T>(url: string, options?: AxiosRequestConfig): Promise<T>;
  post<T>(url: string, data: any, options?: AxiosRequestConfig): Promise<T>;
};
```

### Files Affected

| File | Change |
|------|--------|
| `src/utils/http-client.ts` | NEW: Create HTTP client with retry/circuit breaker |
| `tests/unit/utils/http-client.test.ts` | NEW: Tests for retry and circuit breaker behavior |
| `src/handlers/routing-suggestion.handler.ts` | Replace axios with shared http-client |
| `src/handlers/journey-confirm.handler.ts` | Use shared http-client (from TD-040) |

### Acceptance Criteria

- [ ] `http-client.ts` implements retry with exponential backoff
- [ ] `http-client.ts` implements circuit breaker pattern
- [ ] Handlers use shared client instead of direct axios
- [ ] Tests verify retry behavior (mock consecutive failures then success)
- [ ] Tests verify circuit breaker opens after threshold failures
- [ ] Tests verify circuit breaker half-opens after cooldown

### Dependencies

- Depends on TD-WHATSAPP-040 (journey-confirm.handler will also use this client)

---

## Phase TD-0.5: Data Layer Impact Analysis

### Assessment

None of these TD items affect the data layer:
- No schema changes required
- No migrations needed
- No database queries modified

**Decision**: Skip TD-0.5 (Hoops not needed)

---

## Implementation Order

Due to dependencies, the implementation order is:

1. **TD-WHATSAPP-038** (stateData fix) - No dependencies
2. **TD-WHATSAPP-039** (timeout) - Depends on 038
3. **TD-WHATSAPP-040** (inline routing) - Depends on 038, 039
4. **TD-WHATSAPP-041** (retry/circuit breaker) - Depends on 040

**Note**: Jessie should write tests for ALL items before Blake implements any fixes (TDD principle).

---

## Handoff to Jessie (Phase TD-1)

### Context

Quinn has completed Phase TD-0 Planning. All 4 TD items have been specified with clear acceptance criteria and file changes required.

### Deliverables Required (TD-1)

For each TD item, Jessie must write/update tests BEFORE Blake implements:

1. **TD-WHATSAPP-038**:
   - Test in `webhook.test.ts`: Verify `stateData` is passed to handler context
   - Mock FSM service to return state with data
   - Verify handler receives both `currentState` and `stateData`

2. **TD-WHATSAPP-039**:
   - Test in `routing-suggestion.handler.test.ts`: Verify timeout error handling
   - Mock axios to throw `ECONNABORTED` error
   - Verify user-friendly error message returned
   - Verify transition to `FSMState.ERROR`

3. **TD-WHATSAPP-040**:
   - Tests in `journey-confirm.handler.test.ts`:
     - Test journey-matcher API is called when user confirms (YES)
     - Test direct route skips routing confirmation (goes to AWAITING_TICKET_UPLOAD)
     - Test interchange route presents routing (goes to AWAITING_ROUTING_CONFIRM)
     - Test API error handling (stay in AWAITING_JOURNEY_CONFIRM)
     - Test route data stored in stateData

4. **TD-WHATSAPP-041**:
   - NEW test file: `tests/unit/utils/http-client.test.ts`
     - Test retry with exponential backoff (3 attempts)
     - Test circuit breaker opens after threshold failures
     - Test circuit breaker half-opens after cooldown
     - Test successful request does not trigger retry
     - Test correlation ID is passed through

### Quality Gates (TD-1)

- [ ] All tests written BEFORE implementation
- [ ] Tests fail initially (RED phase of TDD)
- [ ] No placeholder assertions
- [ ] Tests cover all acceptance criteria
- [ ] Behavior-focused (test WHAT, not HOW)

### Blocking Rules

- Blake MUST NOT start TD-2 until Jessie completes TD-1
- Test Lock Rule: Blake MUST NOT modify Jessie's tests

---

## Sign-off

| Role | Agent | Status | Date |
|------|-------|--------|------|
| Planning | Quinn | COMPLETE | 2026-01-24 |
| Data Impact | Hoops | SKIPPED (N/A) | 2026-01-24 |
| Test Spec | Jessie | PENDING | |
| Implementation | Blake | BLOCKED | |
| QA | Jessie | BLOCKED | |
| Deployment | Moykle | BLOCKED | |
| Verification | Quinn | BLOCKED | |
