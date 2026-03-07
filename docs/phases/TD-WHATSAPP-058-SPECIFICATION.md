# TD-WHATSAPP-058: Manual Ticket Price, Class, and Type Collection on SKIP

## Phase TD-0: Remediation Specification

**BL Item**: BL-137 (page: `303815ba-72ee-8197-ae1e-c22f18ccee18`)
**Status**: In Progress
**Severity**: BLOCKING
**Service**: whatsapp-handler
**Domain**: User Channels
**Date**: 2026-03-07
**Workflow**: Technical Debt Remediation (TD-0 through TD-5)

---

## Business Context

When a user says SKIP at the `AWAITING_TICKET_UPLOAD` step, the journey is submitted with no ticket data. The eligibility-engine requires three fields to calculate compensation:

1. `ticket_fare_pence` -- used to calculate compensation amount
2. `ticket_class` (standard/first) -- determines compensation percentage
3. `ticket_type` (Advance/Off-Peak/Anytime/Super Off-Peak) -- selects the correct Delay Repay scheme

Without these fields, the pipeline produces GBP 0.00 compensation even when delays are detected. This is the last known issue preventing meaningful compensation in the E2E pipeline (ref: CH-24, `308815ba-72ee-81b7`).

**Source**: Notion > Backlog > BL-137 (TD-WHATSAPP-058)

---

## Epic Detection Analysis

The BL item has **13 acceptance criteria**, which exceeds the 5-AC threshold. However, decomposition is **NOT required** for the following reasons:

1. **Single service**: All 13 ACs are within whatsapp-handler only
2. **Sequential handler additions**: The 3 new handlers follow an identical pattern (prompt, validate input, store in stateData, transition)
3. **No multi-service coordination**: The outbox event payload already carries journey data fields (from TD-WHATSAPP-055); we are adding 3 fields to the same payload
4. **No schema changes**: No database migrations needed -- ticket data is stored in Redis stateData and then serialized into the outbox event JSONB payload
5. **No new external integrations**: All changes are internal FSM flow modifications
6. **AC-11 through AC-13 are test specifications**, not separate functional requirements

**Decision**: Proceed as a single TD item. No decomposition needed.

---

## Functional Requirements

### New FSM States (AC-1)

Add 3 new states to `FSMState` enum in `fsm.service.ts`:

```
AWAITING_TICKET_PRICE    -- After SKIP at ticket upload
AWAITING_TICKET_CLASS    -- After valid price entry
AWAITING_TICKET_TYPE     -- After valid class entry
```

This brings the total from 13 to 16 FSM states.

### Modified Handler: ticket-upload.handler.ts (AC-2)

Current SKIP path (line 22-24):
```typescript
if (input === 'SKIP') {
    return createJourneyAndRespond(ctx, null);
}
```

New SKIP path: Instead of calling `createJourneyAndRespond`, transition to `AWAITING_TICKET_PRICE` with response message:
> "No problem! To help calculate your compensation, how much did your ticket cost? (e.g. GBP 45.50)"

Note: The media upload path (line 17-19) remains unchanged -- if the user uploads a ticket image, journey submission proceeds immediately without the manual prompts.

### New Handler: ticket-price.handler.ts (AC-3, AC-4, AC-10, AC-11)

**Input validation**:
- Accept formats: `£45.50`, `45.50`, `£45`, `45`
- Extract value in pence (integer): `£45.50` -> `4550`
- Edge cases: `£0` or `0` -> `0` pence (valid); negative values -> error; non-numeric -> error
- Error response: "Sorry, I couldn't understand that price. Please enter the amount you paid, e.g. £45.50"

**SKIP escape** (AC-10):
- If input is `SKIP`, call `createJourneyAndRespond(ctx, null)` -- preserving current fallback behavior (journey submitted without ticket data)

**Success path** (AC-4):
- Store `ticket_fare_pence` in stateData (merged with existing data)
- Respond: "Was this a Standard or First Class ticket?"
- Transition to `AWAITING_TICKET_CLASS`

### New Handler: ticket-class.handler.ts (AC-5, AC-6, AC-12)

**Input validation**:
- Accept: `STANDARD`, `FIRST` (case-insensitive)
- Error response: "Sorry, I didn't recognise that. Please reply STANDARD or FIRST"

**Success path** (AC-6):
- Store `ticket_class` in stateData (value: `standard` or `first`, lowercased)
- Respond: "What type of ticket did you buy? Reply: ADVANCE, ANYTIME, OFF-PEAK, or SUPER OFF-PEAK"
- Transition to `AWAITING_TICKET_TYPE`

### New Handler: ticket-type.handler.ts (AC-7, AC-8, AC-13)

**Input validation**:
- Accept: `ADVANCE`, `ANYTIME`, `OFF-PEAK`, `SUPER OFF-PEAK` (case-insensitive)
- Error response: "Sorry, I didn't recognise that ticket type. Please reply: ADVANCE, ANYTIME, OFF-PEAK, or SUPER OFF-PEAK"

**Success path** (AC-8):
- Store `ticket_type` in stateData (value: lowercased, e.g. `off-peak`, `super off-peak`)
- Call `createJourneyAndRespond(ctx, null)` with ticket data from stateData included in the outbox event payload

### Outbox Event Payload (AC-9)

The `journey.created` event payload (built in `createJourneyAndRespond`) must include:

```json
{
  "ticket_fare_pence": 4550,
  "ticket_class": "standard",
  "ticket_type": "off-peak"
}
```

These fields are only present when the user completes the manual ticket flow. When user SKIPs at the price prompt (AC-10), these fields remain absent (preserving current behavior).

The `createJourneyAndRespond` function must read these fields from `ctx.stateData` if present.

### Handler Registration (handlers/index.ts)

Register 3 new handlers in `initializeHandlers()`:
```
registerHandler(FSMState.AWAITING_TICKET_PRICE, ticketPriceHandler);
registerHandler(FSMState.AWAITING_TICKET_CLASS, ticketClassHandler);
registerHandler(FSMState.AWAITING_TICKET_TYPE, ticketTypeHandler);
```

---

## Acceptance Criteria (from BL-137)

- [ ] AC-1: New FSM states `AWAITING_TICKET_PRICE`, `AWAITING_TICKET_CLASS`, and `AWAITING_TICKET_TYPE` added
- [ ] AC-2: When user sends SKIP at `AWAITING_TICKET_UPLOAD`, handler responds with price prompt and transitions to `AWAITING_TICKET_PRICE`
- [ ] AC-3: `ticket-price.handler` parses price input (£45.50, 45.50, £45, 45) -> pence. Error for invalid input.
- [ ] AC-4: After valid price entry, responds with class prompt and transitions to `AWAITING_TICKET_CLASS`
- [ ] AC-5: `ticket-class.handler` accepts STANDARD or FIRST (case-insensitive). Error for invalid input.
- [ ] AC-6: After valid class entry, responds with type prompt and transitions to `AWAITING_TICKET_TYPE`
- [ ] AC-7: `ticket-type.handler` accepts ADVANCE, ANYTIME, OFF-PEAK, SUPER OFF-PEAK (case-insensitive). Error for invalid input.
- [ ] AC-8: After valid type entry, transitions to journey submission
- [ ] AC-9: Collected ticket data (ticket_fare_pence, ticket_class, ticket_type) stored in stateData and included in journey.created outbox event payload
- [ ] AC-10: User can type SKIP at the price prompt to submit without ticket data (fallback)
- [ ] AC-11: Unit tests for price parsing (valid formats, invalid input, edge cases)
- [ ] AC-12: Unit tests for class selection (STANDARD, FIRST, case variants, invalid)
- [ ] AC-13: Unit tests for type selection (ADVANCE, ANYTIME, OFF-PEAK, SUPER OFF-PEAK, case variants, invalid)

---

## ADR Applicability

| ADR | Applies | Notes |
|-----|---------|-------|
| ADR-001 Schema-per-service | No | No schema changes -- data stays in Redis stateData + outbox JSONB |
| ADR-002 Winston Logger | Yes | New handlers must use @railrepay/winston-logger |
| ADR-003 Testcontainers | No | No database changes; unit tests only |
| ADR-004 Vitest | Yes | All tests use Vitest |
| ADR-005 Railway Direct Deploy | Yes | Deploy via git push to main |
| ADR-008 Prometheus Metrics | No | No new metrics needed for this change |
| ADR-010 Smoke Tests | Yes | Existing smoke test (health endpoint) sufficient |
| ADR-014 TDD | Yes | Jessie writes failing tests first, Blake implements |

---

## Files Affected

| File | Action | Owner |
|------|--------|-------|
| `src/services/fsm.service.ts` | Add 3 enum values | Blake |
| `src/handlers/ticket-upload.handler.ts` | Modify SKIP path | Blake |
| `src/handlers/ticket-price.handler.ts` | **Create** | Blake |
| `src/handlers/ticket-class.handler.ts` | **Create** | Blake |
| `src/handlers/ticket-type.handler.ts` | **Create** | Blake |
| `src/handlers/index.ts` | Register 3 new handlers | Blake |
| `tests/unit/handlers/ticket-price.handler.test.ts` | **Create** | Jessie |
| `tests/unit/handlers/ticket-class.handler.test.ts` | **Create** | Jessie |
| `tests/unit/handlers/ticket-type.handler.test.ts` | **Create** | Jessie |
| `tests/unit/handlers/ticket-upload.handler.TD-058.test.ts` | **Create** (SKIP path change tests) | Jessie |
| `tests/unit/services/fsm.service.TD-058.test.ts` | **Create** (new state enum tests) | Jessie |

---

## Hoops Assessment (TD-0.5)

**Hoops is NOT needed.** Rationale:

1. No database schema changes -- ticket data is stored in Redis stateData (ephemeral)
2. The outbox_events table already has a JSONB `payload` column -- adding fields to the JSON does not require a migration
3. The outbox event payload schema is not formally documented in a schema file (it is implicit in the handler code)
4. No new tables, columns, indexes, or constraints needed

---

## Downstream Impact

The `journey.created` Kafka event is consumed by `journey-matcher`. The new fields (`ticket_fare_pence`, `ticket_class`, `ticket_type`) will be passed through the pipeline:

- **journey-matcher**: Stores journey data; these fields will be in the JSONB payload. No code changes needed (journey-matcher passes through to eligibility).
- **evaluation-coordinator**: Reads journey data and passes to eligibility-engine. May already handle these fields.
- **eligibility-engine**: This is the consumer that NEEDS these fields. It already has columns for them in its schema.

No downstream service changes are required for this TD -- the fields are added to the existing JSONB payload and will propagate through the existing pipeline.

---

## Handoff Sequence

```
Quinn (TD-0: This specification) -- COMPLETE
    |
    v
Jessie (TD-1: Write failing tests for all 13 ACs)
    - ticket-price.handler.test.ts (AC-3, AC-4, AC-10, AC-11)
    - ticket-class.handler.test.ts (AC-5, AC-6, AC-12)
    - ticket-type.handler.test.ts (AC-7, AC-8, AC-13)
    - ticket-upload.handler.TD-058.test.ts (AC-2: SKIP path change)
    - fsm.service.TD-058.test.ts (AC-1: new enum values)
    - Outbox payload assertion (AC-9)
    |
    v
Blake (TD-2: Implement to make all tests GREEN)
    - Add 3 FSM states
    - Modify ticket-upload SKIP path
    - Create 3 new handlers
    - Register handlers in index.ts
    - Include ticket data in outbox payload
    |
    v
Jessie (TD-3: QA sign-off)
    - Coverage >= 80% lines/functions/statements, >= 75% branches
    - All 13 ACs verified with passing tests
    - Test Lock Rule enforced
    |
    v
Moykle (TD-4: Deploy)
    - git push to main
    - Railway auto-deploy
    - Verify health endpoint
    |
    v
Quinn (TD-5: Verify + close)
    - E2E verification: SKIP flow produces non-zero compensation
    - Update BL-137 status to Done
    - Changelog entry
```

---

## Handoff to Jessie - Phase TD-1

**From**: Quinn (Phase TD-0)
**Context**: TD-WHATSAPP-058 specification complete. This adds 3 new FSM states and 3 new handlers to collect ticket price, class, and type when the user SKIPs ticket upload. No database changes. No downstream service changes.

### Deliverables Required
- [ ] `tests/unit/handlers/ticket-price.handler.test.ts` -- parameterized tests for price parsing (AC-3, AC-4, AC-10, AC-11)
- [ ] `tests/unit/handlers/ticket-class.handler.test.ts` -- tests for class validation (AC-5, AC-6, AC-12)
- [ ] `tests/unit/handlers/ticket-type.handler.test.ts` -- tests for type validation (AC-7, AC-8, AC-13)
- [ ] `tests/unit/handlers/ticket-upload.handler.TD-058.test.ts` -- tests for modified SKIP path (AC-2)
- [ ] `tests/unit/services/fsm.service.TD-058.test.ts` -- tests for new enum values (AC-1)
- [ ] At least one test asserting outbox event payload includes ticket fields (AC-9)
- [ ] All tests MUST FAIL (RED phase) -- no implementation exists yet

### Quality Gates
- [ ] Every AC (1-13) has at least one corresponding test
- [ ] Tests import from source paths that will exist (handler file paths listed above)
- [ ] Tests use Vitest (import from 'vitest'), NOT Jest
- [ ] Tests follow existing handler test patterns (see ticket-upload.handler.test.ts for HandlerContext mock pattern)
- [ ] Price parsing tests include: valid formats (pence 4550, 4500, etc.), zero, negative, non-numeric, empty string
- [ ] Class/type tests include: valid values, case-insensitive variants, invalid input, empty string

### Blocking Rules
- Blake MUST NOT start implementation until Jessie's tests exist and FAIL
- Test Lock Rule: Blake cannot modify Jessie's tests

### References
- BL-137: `303815ba-72ee-8197-ae1e-c22f18ccee18`
- Existing handler test pattern: `tests/unit/handlers/ticket-upload.handler.test.ts`
- FSM service: `src/services/fsm.service.ts` (13 states currently)
- Handler index: `src/handlers/index.ts` (registration pattern)
- HandlerContext/HandlerResult interfaces: `src/handlers/index.ts` lines 25-46
- Outbox event type: `src/db/types.ts` lines 92-100

---

## Side Finding: BL-7 (TD-WHATSAPP-046) Resolved

BL-7 requested creation of `error.handler.ts` for the FSM ERROR state. This was implemented as part of TD-WHATSAPP-054 (Changelog: `302815ba-72ee-8166`). The file exists at `src/handlers/error.handler.ts` and is registered in `handlers/index.ts` line 129. **BL-7 status updated to Done.**
