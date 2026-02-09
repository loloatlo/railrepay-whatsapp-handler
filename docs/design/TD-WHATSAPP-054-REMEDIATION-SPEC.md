# TD-WHATSAPP-054 Remediation Specification

## Metadata

| Field | Value |
|-------|-------|
| **Backlog ID** | TD-WHATSAPP-054 |
| **Notion Page** | `301815ba-72ee-81c1-90f5-dfc3653397ea` |
| **Severity** | BLOCKING |
| **Service** | whatsapp-handler |
| **Created By** | Quinn (TD-0) |
| **Date** | 2026-02-09 |
| **Workflow** | Technical Debt Remediation (TD-0 through TD-5) |
| **ADA Decision** | AC-5 Escalation Target = Option A (Generic ERROR handler) |

---

## 1. Problem Statement

The `routing-alternative.handler.ts` in whatsapp-handler contains **hardcoded mock route data** (lines 25-50) instead of using real data. Specifically:

1. **Set 1 alternatives** (user rejects initial suggestion) are hardcoded PAD-RDG-CDF, PAD-BHM-CDF, PAD-SWA-CDF routes regardless of the user's actual journey.
2. **Set 2+ alternatives** (user rejects first alternatives via NONE) present the identical hardcoded routes again.
3. **Route selection** stores only `{ selectedAlternative: number }` (an index) instead of the full route object.
4. **The NO path** from journey-confirm goes to `AWAITING_JOURNEY_TIME` instead of `AWAITING_ROUTING_ALTERNATIVE`.
5. **No ERROR handler** is registered for `FSMState.ERROR`, so users who exhaust all alternatives hit an unhandled state.
6. **stateData propagation** is broken in routing-suggestion.handler: YES path stores only `{ routingConfirmed: true }` and NO path stores only `{ alternativeCount: 1 }`, dropping all journey context.

### Root Cause

This handler was built as a scaffold during the initial whatsapp-handler development and was never updated to use real data from the journey-matcher API or from stateData passed through the FSM.

---

## 2. ADA Decision Record

**Trigger**: AC-5 required a decision on what happens when a user exhausts all 3 sets of routing alternatives and transitions to `FSMState.ERROR`.

**Options Evaluated**:
- **Option A**: Register a generic ERROR handler (sends apology message, transitions to AUTHENTICATED)
- **Option B**: Inline escalation message in routing-alternative.handler (no ERROR handler)
- **Option C**: Route-specific ERROR sub-handler (contextual error messages)

**Decision**: **Option A** -- Generic ERROR handler.

**Rationale**: The ERROR state exists in the FSM enum (line 42 of `fsm.service.ts`) but has no registered handler. A generic handler is reusable for any future ERROR transitions (e.g., from routing-suggestion.handler error paths, journey-time.handler JOURNEY_MATCHER_URL missing, etc.). The routing-alternative.handler already publishes the `journey.routing_escalation` event BEFORE transitioning to ERROR, so the ERROR handler does not need event-publishing responsibility.

---

## 3. Acceptance Criteria

| AC | Description | Verification Method |
|----|-------------|---------------------|
| AC-1 | `routing-alternative.handler` uses stateData routes (Set 1) and journey-matcher API (Set 2+) instead of hardcoded mocks | Unit test: mock journey-matcher API, verify no hardcoded route data in handler output |
| AC-2 | `AWAITING_ROUTING_ALTERNATIVE` is reachable from `AWAITING_JOURNEY_CONFIRM` when user says NO | Unit test: journey-confirm handler NO path transitions to `AWAITING_ROUTING_ALTERNATIVE` (not `AWAITING_JOURNEY_TIME`) |
| AC-3 | `AWAITING_ROUTING_ALTERNATIVE` is reachable from `AWAITING_ROUTING_CONFIRM` when user rejects suggested route | Unit test: routing-suggestion handler NO path transitions to `AWAITING_ROUTING_ALTERNATIVE` |
| AC-4 | Route selection stores the full route object in `stateData.confirmedRoute` and transitions to `AWAITING_TICKET_UPLOAD` | Unit test: verify stateData contains full route object (legs, totalDuration), not just an index |
| AC-5 | NONE after 3 sets transitions to ERROR with `journey.routing_escalation` event; ERROR handler sends user message and transitions to AUTHENTICATED | Unit test: verify escalation event published, ERROR handler registered, sends apology message, transitions to AUTHENTICATED |
| AC-6 | `routing-suggestion.handler` YES and NO paths preserve all stateData fields via spread operator | Unit test: verify stateData propagation preserves journey context (journeyId, origin, destination, travelDate, etc.) |

---

## 4. Files Affected

### Files to Modify

| File | Change Summary | AC |
|------|---------------|-----|
| `src/handlers/journey-confirm.handler.ts` | NO path: change `AWAITING_JOURNEY_TIME` to `AWAITING_ROUTING_ALTERNATIVE` | AC-2 |
| `src/handlers/journey-time.handler.ts` | Store ALL routes (not just `routes[0]`) in stateData as `allRoutes` | AC-1 |
| `src/handlers/routing-alternative.handler.ts` | Replace hardcoded mocks with stateData routes (Set 1) + journey-matcher API (Set 2+); store full route on selection | AC-1, AC-3, AC-4, AC-5 |
| `src/handlers/routing-suggestion.handler.ts` | Fix stateData propagation on YES and NO paths using spread operator | AC-6 |
| `src/handlers/index.ts` | Register ERROR handler in `initializeHandlers()` | AC-5 |

### Files to Create

| File | Purpose | AC |
|------|---------|-----|
| `src/handlers/error.handler.ts` | Generic ERROR state handler | AC-5 |
| `tests/unit/handlers/routing-alternative.handler.test.ts` | Tests for AC-1, AC-3, AC-4, AC-5 | AC-1, AC-3, AC-4, AC-5 |
| `tests/unit/handlers/error.handler.test.ts` | Tests for ERROR handler | AC-5 |

### Existing Tests to Update

| File | Change Summary | AC |
|------|---------------|-----|
| `tests/unit/handlers/journey-confirm.handler.test.ts` | Update NO path expectations: `AWAITING_ROUTING_ALTERNATIVE` instead of `AWAITING_JOURNEY_TIME` | AC-2 |
| `tests/unit/handlers/routing-suggestion.handler.test.ts` | Add stateData propagation tests for YES and NO paths | AC-6 |
| `tests/unit/handlers/journey-time.handler.test.ts` | Add test verifying `allRoutes` stored in stateData | AC-1 |

---

## 5. Detailed Change Specifications

### 5.1 journey-confirm.handler.ts (AC-2)

**Current behavior** (line 69): NO path transitions to `FSMState.AWAITING_JOURNEY_TIME`.

**Required behavior**: NO path transitions to `FSMState.AWAITING_ROUTING_ALTERNATIVE`. The user has already seen a matched route; rejecting it means they want alternatives, not to re-enter their time.

**Specific change**:
- Line 69: `nextState: FSMState.AWAITING_JOURNEY_TIME` changes to `nextState: FSMState.AWAITING_ROUTING_ALTERNATIVE`
- Line 66 response text: Should indicate alternatives are being fetched, not ask for a new time
- stateData must preserve all fields via `...ctx.stateData` (already does this on line 71)

### 5.2 journey-time.handler.ts (AC-1)

**Current behavior** (line 105): Stores only `routes[0]` as `matchedRoute`. All other routes from the API response are discarded.

**Required behavior**: Store the full `routes` array as `stateData.allRoutes` alongside the existing `matchedRoute`. This provides the routing-alternative.handler with real route data for Set 1 alternatives (indices 1, 2, 3 from the original API response).

**Specific change**:
- After line 89 (`const routes = apiResponse.data.routes;`), the stateData in both the direct and interchange return blocks should include `allRoutes: routes`
- Direct path stateData (line 129-134): Add `allRoutes: routes`
- Interchange path stateData (line 157-163): Add `allRoutes: routes`

### 5.3 routing-alternative.handler.ts (AC-1, AC-3, AC-4, AC-5)

This is the primary file requiring remediation. The entire handler logic changes.

**Current behavior**: Hardcoded mock alternatives, stores only `selectedAlternative: number`.

**Required behavior**:

**Set 1 (entering from AWAITING_ROUTING_CONFIRM or AWAITING_JOURNEY_CONFIRM NO path)**:
- Read `stateData.allRoutes` from FSM context
- Display routes at indices [1], [2], [3] (skip index [0] which was the already-rejected suggested route)
- If fewer than 3 additional routes exist, display only what is available
- If no additional routes exist, immediately call journey-matcher API for offset alternatives

**Set 2+ (user says NONE, alternativeCount < 3)**:
- Call journey-matcher API: `GET /routes?from={origin}&to={destination}&date={travelDate}&time={departureTime}&offset={alternativeCount * 3}`
- Display returned routes as numbered options 1, 2, 3
- Increment `alternativeCount`

**Selection (user picks 1, 2, or 3)**:
- Look up the actual route object from the currently-displayed alternatives
- Store as `stateData.confirmedRoute` (full route object with legs, totalDuration, etc.)
- Also store `routingConfirmed: true`
- Transition to `AWAITING_TICKET_UPLOAD`

**NONE after alternativeCount >= 3**:
- Publish `journey.routing_escalation` event (existing behavior is correct)
- Transition to `FSMState.ERROR` (existing behavior is correct)
- Use real journeyId from stateData (not hardcoded `'journey-456'`)

**stateData propagation**: All return paths must use `...ctx.stateData` spread to preserve journey context.

### 5.4 routing-suggestion.handler.ts (AC-6)

**Current behavior**:
- YES path (line 229-231): Returns `{ routingConfirmed: true }` only, dropping journeyId, origin, destination, travelDate, suggestedRoute, departureTime
- NO path (line 243-245): Returns `{ alternativeCount: 1 }` only, dropping all journey context

**Required behavior**:
- YES path: `{ ...ctx.stateData, routingConfirmed: true, confirmedRoute: ctx.stateData?.suggestedRoute }`
- NO path: `{ ...ctx.stateData, alternativeCount: 1 }`

### 5.5 error.handler.ts (AC-5) -- NEW FILE

**Purpose**: Generic handler for `FSMState.ERROR`. Catches any conversation that reaches the ERROR state.

**Behavior**:
1. Send message: "Sorry, we couldn't find a suitable route for your journey. We've escalated this to our support team who will review your case within 24 hours. In the meantime, type MENU to start a new claim or CHECK to view an existing one."
2. Transition to `FSMState.AUTHENTICATED`
3. Log the error recovery with correlation ID
4. Does NOT publish events (the transitioning handler is responsible for events before transitioning to ERROR)

**Interface**:
```typescript
export async function errorHandler(ctx: HandlerContext): Promise<HandlerResult>
```

### 5.6 index.ts (AC-5)

**Current behavior**: `initializeHandlers()` registers 11 handlers (START through AWAITING_TICKET_UPLOAD). No handler for ERROR.

**Required behavior**: Add `registerHandler(FSMState.ERROR, errorHandler)` with corresponding import of `errorHandler` from `./error.handler.js`.

---

## 6. Test Specification for Jessie (Phase TD-1)

### 6.1 New Test File: routing-alternative.handler.test.ts

Tests for the remediated routing-alternative handler. Must mock:
- `@railrepay/winston-logger` (infrastructure package mock per Section 6.1.11)
- `axios` (for journey-matcher API calls in Set 2+)
- `process.env.JOURNEY_MATCHER_URL`

**Test cases required**:

**AC-1: stateData routes for Set 1**
- Given stateData contains `allRoutes` with 4 routes, when entering AWAITING_ROUTING_ALTERNATIVE, then display routes[1], routes[2], routes[3] (not hardcoded data)
- Given stateData contains `allRoutes` with only 2 routes, when entering, then display only routes[1] (the one additional route available)

**AC-1: journey-matcher API for Set 2+**
- Given alternativeCount is 1 and user says NONE, when handler executes, then axios.get is called with offset parameter
- Verify correlation ID is propagated in X-Correlation-ID header

**AC-3: Reachable from AWAITING_ROUTING_CONFIRM**
- Given currentState is AWAITING_ROUTING_CONFIRM and input is NO, when handler executes, then nextState is AWAITING_ROUTING_ALTERNATIVE

**AC-4: Full route stored on selection**
- Given alternatives are displayed and user picks "2", then stateData.confirmedRoute contains the full route object (legs array, totalDuration, etc.)
- Verify stateData.confirmedRoute is NOT just a number

**AC-5: NONE after 3 sets**
- Given alternativeCount is 3 and input is NONE, then nextState is FSMState.ERROR
- Verify publishEvents contains journey.routing_escalation with real journeyId from stateData
- Verify escalation event payload.userId comes from ctx.user.id

**stateData propagation**
- All return paths preserve ctx.stateData fields (origin, destination, travelDate, journeyId)

### 6.2 New Test File: error.handler.test.ts

**Test cases required**:

**AC-5: ERROR handler behavior**
- When invoked, sends message containing "escalated" and "support team" and "24 hours"
- When invoked, transitions to FSMState.AUTHENTICATED
- When invoked, does NOT publish any events (publishEvents is undefined or empty)
- Handles missing user gracefully (ctx.user is null)
- Logs error recovery with correlation ID

### 6.3 Existing Test Updates

**journey-confirm.handler.test.ts (AC-2)**:
- The test at line 120-125 ("should accept 'NO' and allow user to try different time") currently expects `FSMState.AWAITING_JOURNEY_TIME`. Update to expect `FSMState.AWAITING_ROUTING_ALTERNATIVE`.
- The test at line 123 expects response to contain "alternative" -- this is already correct.
- The test at line 129 ("should accept 'no' (lowercase)") currently expects `FSMState.AWAITING_JOURNEY_TIME`. Update to expect `FSMState.AWAITING_ROUTING_ALTERNATIVE`.

**routing-suggestion.handler.test.ts (AC-6)**:
- Add test: YES path preserves journeyId, origin, destination, travelDate, suggestedRoute in stateData
- Add test: YES path adds confirmedRoute equal to ctx.stateData.suggestedRoute
- Add test: NO path preserves journeyId, origin, destination, travelDate in stateData
- Add test: NO path adds alternativeCount: 1

**journey-time.handler.test.ts (AC-1)**:
- Add test: stateData includes `allRoutes` array containing all routes from API response
- Verify allRoutes is the complete routes array, not just the first element

### 6.4 Existing Test Patterns to Follow

Jessie should review these files for consistent mock patterns and assertion style:
- `tests/unit/handlers/routing-suggestion.handler.test.ts` -- axios mocking, HandlerContext structure
- `tests/unit/handlers/routing-suggestion.handler.TD-028.test.ts` -- Previous TD remediation test patterns
- `tests/unit/handlers/journey-confirm.handler.test.ts` -- vi.hoisted() logger mock pattern
- `tests/unit/handlers/journey-time.handler.test.ts` -- axios mock with vi.mocked(), env var cleanup

### 6.5 Key Code Context for Test Writing

1. **HandlerContext interface** (`src/handlers/index.ts` lines 25-35):
   - `stateData?: Record<string, any>` -- Optional, used for FSM state data
   - `currentState: FSMState` -- Current FSM state
   - `correlationId: string` -- For distributed tracing
   - `user: User | null` -- May be null
   - `[key: string]: any` -- Allow additional properties

2. **HandlerResult interface** (`src/handlers/index.ts` lines 41-46):
   - `response: string` -- Message text
   - `nextState?: FSMState` -- State to transition to
   - `stateData?: Record<string, any>` -- Data to store with state
   - `publishEvents?: OutboxEvent[]` -- Events to publish

3. **OutboxEvent interface** (`src/db/types.ts` lines 92-100):
   - `id: string` -- UUID (generated by repository)
   - `aggregate_id: string` -- Entity ID
   - `aggregate_type: 'user' | 'journey' | 'claim'`
   - `event_type: string`
   - `payload: Record<string, any>`
   - `published_at: Date | null`
   - `created_at: Date`

4. **FSMState.ERROR** is defined at line 42 of `fsm.service.ts` as `ERROR = 'ERROR'`

5. **Current routing-alternative.handler** accesses alternativeCount via `(ctx as any).stateData?.alternativeCount` (line 121). The remediated version should use `ctx.stateData?.alternativeCount` directly (the HandlerContext already has `stateData`).

---

## 7. Implementation Constraints for Blake (Phase TD-2)

1. **Test Lock Rule applies**: Blake MUST NOT modify any tests written by Jessie in TD-1. If a test appears incorrect, hand back to Jessie with explanation.

2. **No new hardcoded data**: All route data must come from either stateData (populated by journey-time.handler) or the journey-matcher API.

3. **journey-matcher API contract**: `GET /routes?from={CRS}&to={CRS}&date={YYYY-MM-DD}&time={HH:MM}&offset={N}` returns `{ routes: Array<{ legs: Array<{ from, to, operator, departure, arrival }>, totalDuration: string }> }`.

4. **Error handler must be generic**: The error.handler.ts must work for ANY transition to ERROR, not just routing exhaustion. Do not reference routing-specific context.

5. **Preserve backward compatibility**: The routing-alternative.handler must still handle the case where `stateData.allRoutes` is undefined (fallback to API call).

6. **Use @railrepay/winston-logger**: All logging must use `createLogger({ serviceName: 'whatsapp-handler' })` per ADR-002.

7. **Timeout on API calls**: Any new axios calls to journey-matcher must include `timeout: 15000` per TD-WHATSAPP-039.

---

## 8. Definition of Done

- [ ] All 6 ACs have passing tests (Jessie verifies in TD-3)
- [ ] No hardcoded route data remains in routing-alternative.handler.ts
- [ ] ERROR handler registered and functional
- [ ] stateData propagation verified across the full routing flow
- [ ] journey-confirm NO path correctly routes to AWAITING_ROUTING_ALTERNATIVE
- [ ] Coverage thresholds met: >=80% lines/functions/statements, >=75% branches
- [ ] No `any` type assertions except where interfacing with untyped stateData
- [ ] ESLint/Prettier clean
- [ ] All existing tests continue to pass (no regressions)
- [ ] Technical debt recorded if any shortcuts taken

---

## 9. Workflow Sequence

```
Phase TD-0  (Quinn)  -- COMPLETE -- This specification
Phase TD-1  (Jessie) -- NEXT     -- Write failing tests for all 6 ACs
Phase TD-2  (Blake)  -- BLOCKED  -- Implement fixes to make tests GREEN
Phase TD-3  (Jessie) -- BLOCKED  -- QA sign-off, coverage verification
Phase TD-4  (Moykle) -- BLOCKED  -- Deploy to Railway
Phase TD-5  (Quinn)  -- BLOCKED  -- Verification, Backlog update, Changelog entry
```

---

## 10. Risk Register

| Risk | Mitigation |
|------|------------|
| journey-matcher API may not support `offset` parameter | Fallback: request all routes and slice locally. Create TD item if API change needed. |
| Existing routing-suggestion.handler tests may break when stateData changes | Jessie updates these tests in TD-1 (they are Jessie's tests per Test Lock Rule). |
| journey-confirm NO path change may break integration tests | Jessie reviews `tests/integration/journey-confirm-routing-flow.test.ts` in TD-1. |
| ERROR handler may mask real errors if too generic | Handler logs the transition with full context for debugging; message is user-friendly. |

---

## Appendix A: Current FSM State Diagram (Routing Flow)

```
                    AWAITING_JOURNEY_TIME
                            |
                    [time provided, API called]
                            |
                            v
                    AWAITING_JOURNEY_CONFIRM
                      /              \
                   YES                NO
                    |                  |
                    v                  v
            AWAITING_TICKET     AWAITING_JOURNEY_TIME  <-- BUG (AC-2)
              _UPLOAD           Should be: AWAITING_ROUTING_ALTERNATIVE
```

### After Remediation:

```
                    AWAITING_JOURNEY_TIME
                            |
                    [time provided, API called, allRoutes stored]
                            |
                            v
                    AWAITING_JOURNEY_CONFIRM
                      /              \
                   YES                NO
                    |                  |
                    v                  v
            AWAITING_TICKET     AWAITING_ROUTING_ALTERNATIVE
              _UPLOAD                  |
                              [Set 1: stateData routes]
                              [Set 2+: journey-matcher API]
                                 /    |    \
                               1      2      3     NONE
                               |      |      |       |
                               v      v      v       v
                          AWAITING_TICKET    (alternativeCount < 3?)
                            _UPLOAD           /              \
                                           YES               NO
                                            |                 |
                                            v                 v
                                    AWAITING_ROUTING     FSMState.ERROR
                                     _ALTERNATIVE          |
                                                    [escalation event]
                                                           |
                                                           v
                                                    AUTHENTICATED
```
