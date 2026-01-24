# Phase US-2 Handoff Package for Blake

**From**: Jessie (QA Engineer / TDD Enforcer)
**To**: Blake (Backend Engineer)
**Date**: 2026-01-24
**User Story**: Submitting a Journey to RailRepay
**Phase**: US-2 → US-3 (Test Specification complete, Implementation begins)

---

## Summary

I have written comprehensive failing tests for ALL acceptance criteria (AC-1 through AC-6) for the "Submitting a Journey to RailRepay" user story. These tests define the behavior you must implement in Phase US-3.

### Test Coverage

| AC | Description | Test Files | Test Count | Status |
|----|-------------|------------|------------|--------|
| AC-1 | Send journey details to RailRepay | integration test | 1 | ✅ Written (FAILS - no implementation) |
| AC-2 | Routing suggestion for interchange journeys | `routing-suggestion.handler.test.ts` | 7 | ✅ Written (FAILS - handler missing) |
| AC-3 | Up to 3 alternative routing options | `routing-suggestion.handler.test.ts` | 7 | ✅ Written (FAILS - handler missing) |
| AC-4 | Historic journey immediate eligibility | `journey-eligibility.handler.test.ts` | 8 | ✅ Written (FAILS - handler missing) |
| AC-5 | Future journey tracking confirmation | `journey-eligibility.handler.test.ts` | 4 | ✅ Written (FAILS - handler missing) |
| AC-6 | Proactive notification on delay | `journey-eligibility.handler.test.ts` | 6 | ✅ Written (FAILS - handler missing) |
| FSM | New FSM states for routing workflow | `fsm.service.enhanced.test.ts` | 12 | ✅ Written (FAILS - enum missing states) |
| Integration | Full journey submission flow | `journey-submission-flow.integration.test.ts` | 8 | ✅ Written (FAILS - missing code) |

**Total Tests Written**: 53 tests
**Current Status**: ALL tests FAIL (RED phase) - ready for implementation

---

## Test Files Created

### 1. `tests/unit/handlers/routing-suggestion.handler.test.ts`
**Lines**: 332
**Purpose**: Tests AC-2 and AC-3 (routing confirmation and alternatives)

**Key Test Scenarios**:
- Presenting suggested routing with leg-by-leg breakdown
- Accepting YES to confirm suggested routing
- Accepting NO to request alternatives
- Presenting 3 numbered alternative routes
- Selecting numbered alternative (1, 2, or 3)
- Rejecting all alternatives and escalating after max limit
- Invalid input handling

**Expected Handler**: `src/handlers/routing-suggestion.handler.ts`
**Expected Handler**: `src/handlers/routing-alternative.handler.ts`

**Critical Assertions**:
```typescript
expect(result.response).toContain('requires a change');
expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
expect(result.stateData?.alternativeCount).toBe(1);
expect(result.publishEvents?.[0].event_type).toBe('journey.routing_escalation');
```

---

### 2. `tests/unit/handlers/journey-eligibility.handler.test.ts`
**Lines**: 596
**Purpose**: Tests AC-4, AC-5, AC-6 (eligibility checking and tracking)

**Key Test Scenarios**:

**AC-4 (Historic Journey)**:
- Immediate eligibility check via eligibility-engine
- Eligible journey with compensation amount
- Ineligible journey with explanation
- Handling eligibility-engine unavailable
- Missing delay data scenario

**AC-5 (Future Journey)**:
- Register journey with delay-tracker
- Confirmation message to user
- Journey details in confirmation
- Handling delay-tracker unavailable

**AC-6 (Proactive Notification)**:
- Send WhatsApp notification when delay detected
- Include eligibility result in notification
- Handle ineligible delayed journeys
- Respect user notification preferences
- Retry on Twilio API failure

**Expected Handler**: `src/handlers/journey-eligibility.handler.ts`

**Critical Assertions**:
```typescript
expect(result.response).toMatch(/eligible|qualify/i);
expect(result.publishEvents?.[0].event_type).toBe('journey.eligibility_confirmed');
expect(result.response).toContain('saved');
expect(result.response).toContain('track');
expect(result.messageBody).toContain('delay');
```

---

### 3. `tests/unit/services/fsm.service.enhanced.test.ts`
**Lines**: 318
**Purpose**: Tests new FSM states for routing workflow

**Key Test Scenarios**:
- New enum values exist (AWAITING_ROUTING_CONFIRM, AWAITING_ROUTING_ALTERNATIVE)
- State transitions for routing workflow
- Data persistence across routing states
- alternativeCount incrementing correctly
- Redis TTL maintenance for routing states

**Required Changes to `src/services/fsm.service.ts`**:
```typescript
export enum FSMState {
  // ... existing states ...
  AWAITING_ROUTING_CONFIRM = 'AWAITING_ROUTING_CONFIRM', // NEW
  AWAITING_ROUTING_ALTERNATIVE = 'AWAITING_ROUTING_ALTERNATIVE', // NEW
  // ... existing states ...
}
```

**Critical Assertions**:
```typescript
expect(FSMState).toHaveProperty('AWAITING_ROUTING_CONFIRM');
expect(currentState.state).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
expect(currentState.data.alternativeCount).toBe(1);
```

---

### 4. `tests/integration/journey-submission-flow.integration.test.ts`
**Lines**: 625
**Purpose**: End-to-end integration tests with Testcontainers

**Key Test Scenarios**:
- Simple journey (no interchange) - Historic
- Complex journey (with interchange) - Historic
- Alternative routing workflow with selection
- Max 3 alternatives escalation
- Historic journey eligibility check
- Future journey tracking registration
- Proactive notification on delay detection
- Infrastructure wiring (REAL @railrepay/* packages)

**Infrastructure Setup**:
- PostgreSQL container with whatsapp_handler schema
- Redis container for FSM state
- Mock HTTP clients for journey-matcher, eligibility-engine, delay-tracker

**Critical Requirements**:
- Tests use REAL PostgreSQL and Redis (Testcontainers)
- Outbox events verified in database
- At least one test exercises REAL @railrepay/* dependencies (per Testing Strategy § 5.2)

---

## Implementation Requirements for Blake

### 1. New FSM States (MANDATORY FIRST STEP)

**File**: `src/services/fsm.service.ts`

Add to FSMState enum:
```typescript
export enum FSMState {
  START = 'START',
  AWAITING_TERMS = 'AWAITING_TERMS',
  AWAITING_OTP = 'AWAITING_OTP',
  AUTHENTICATED = 'AUTHENTICATED',
  AWAITING_JOURNEY_DATE = 'AWAITING_JOURNEY_DATE',
  AWAITING_JOURNEY_STATIONS = 'AWAITING_JOURNEY_STATIONS',
  AWAITING_JOURNEY_TIME = 'AWAITING_JOURNEY_TIME',
  AWAITING_JOURNEY_CONFIRM = 'AWAITING_JOURNEY_CONFIRM',
  AWAITING_ROUTING_CONFIRM = 'AWAITING_ROUTING_CONFIRM', // NEW - AC-2
  AWAITING_ROUTING_ALTERNATIVE = 'AWAITING_ROUTING_ALTERNATIVE', // NEW - AC-3
  AWAITING_TICKET_UPLOAD = 'AWAITING_TICKET_UPLOAD',
  AWAITING_CLAIM_STATUS = 'AWAITING_CLAIM_STATUS',
  ERROR = 'ERROR',
}
```

Update FSM comment:
```typescript
/**
 * FSM States (13 total) // Changed from 11 to 13
 * Per specification § WhatsApp Message Flow
 */
```

---

### 2. New Handler: `src/handlers/routing-suggestion.handler.ts`

**Responsibility**: Handle routing confirmation for journeys with interchanges (AC-2, partial AC-3)

**Function Signature**:
```typescript
export async function routingSuggestionHandler(ctx: HandlerContext): Promise<HandlerResult>
```

**Behavior**:

**When entering state** (from AWAITING_JOURNEY_TIME):
- Detect journey requires interchange (via journey-matcher API)
- Format suggested route message with leg-by-leg breakdown
- Transition to AWAITING_ROUTING_CONFIRM
- Store suggestedRoute in stateData

**When user sends "YES"**:
- Confirm routing
- Transition to AWAITING_TICKET_UPLOAD
- Set stateData.routingConfirmed = true

**When user sends "NO"**:
- Fetch alternatives from journey-matcher
- Transition to AWAITING_ROUTING_ALTERNATIVE
- Set stateData.alternativeCount = 1
- Store alternatives in stateData

**When user sends invalid input**:
- Stay in AWAITING_ROUTING_CONFIRM
- Send error message with YES/NO prompt

**Integration Points**:
- journey-matcher service: GET /journeys/:id/routes (returns ranked alternatives)
- otp-router service: via journey-matcher

---

### 3. New Handler: `src/handlers/routing-alternative.handler.ts`

**Responsibility**: Handle alternative routing selection (AC-3)

**Function Signature**:
```typescript
export async function routingAlternativeHandler(ctx: HandlerContext): Promise<HandlerResult>
```

**Behavior**:

**When entering state** (from routingSuggestionHandler):
- Present 3 numbered alternatives with route details
- Prompt user to select 1, 2, 3, or NONE

**When user sends "1", "2", or "3"**:
- Confirm selected alternative
- Transition to AWAITING_TICKET_UPLOAD
- Set stateData.selectedAlternative = <number>
- Set stateData.routingConfirmed = true

**When user sends "NONE"**:
- Increment stateData.alternativeCount
- If alternativeCount < 3:
  - Fetch next set of alternatives
  - Stay in AWAITING_ROUTING_ALTERNATIVE
- If alternativeCount >= 3:
  - Transition to ERROR state
  - Publish outbox event: 'journey.routing_escalation'
  - Set stateData.escalationRequired = true

**When user sends invalid input**:
- Stay in AWAITING_ROUTING_ALTERNATIVE
- Send error message with valid options

---

### 4. New Handler: `src/handlers/journey-eligibility.handler.ts`

**Responsibility**: Check eligibility and handle tracking for historic/future journeys (AC-4, AC-5, AC-6)

**Function Signature**:
```typescript
export async function journeyEligibilityHandler(ctx: HandlerContext): Promise<HandlerResult>

export async function sendDelayNotification(
  user: User,
  notification: DelayNotification
): Promise<NotificationResult | null>
```

**Behavior**:

**For HISTORIC journeys** (AC-4):
- After ticket upload (or SKIP), detect journey is historic
- Call eligibility-engine POST /eligibility/evaluate with journeyId
- Parse response: isEligible, compensationAmount, delayMinutes
- Send immediate message to user with result
- Publish outbox event: 'journey.eligibility_confirmed'
- Transition to AUTHENTICATED

**For FUTURE journeys** (AC-5):
- After ticket upload (or SKIP), detect journey is future
- Call delay-tracker POST /journeys/track with journey details
- Send confirmation message: "Journey saved and will be tracked"
- Publish outbox event: 'journey.tracking_registered'
- Transition to AUTHENTICATED

**For PROACTIVE notifications** (AC-6):
- Webhook endpoint: POST /notifications/delay-detected
- Called by delay-tracker when tracked journey is delayed
- Check user notification preferences
- Send WhatsApp message via Twilio with eligibility result
- Publish outbox event: 'journey.delay_notification_sent'
- Handle Twilio API failures with retry

**Integration Points**:
- eligibility-engine service: POST /eligibility/evaluate
- delay-tracker service: POST /journeys/track
- Twilio API: Send WhatsApp message
- Database: whatsapp_handler.user_preferences (notification opt-out)

---

### 5. Update Handler Registry: `src/handlers/index.ts`

Add to `initializeHandlers()`:
```typescript
export async function initializeHandlers(): Promise<void> {
  // ... existing imports ...
  const { routingSuggestionHandler } = await import('./routing-suggestion.handler.js');
  const { routingAlternativeHandler } = await import('./routing-alternative.handler.js');
  const { journeyEligibilityHandler } = await import('./journey-eligibility.handler.js');

  // ... existing registrations ...
  registerHandler(FSMState.AWAITING_ROUTING_CONFIRM, routingSuggestionHandler);
  registerHandler(FSMState.AWAITING_ROUTING_ALTERNATIVE, routingAlternativeHandler);
  // journey-eligibility is called FROM other handlers, not registered directly
}
```

---

## Test Execution Instructions

### Run Unit Tests (should FAIL before implementation)

```bash
cd /mnt/c/Users/nicbo/Documents/RailRepay\ MVP/services/whatsapp-handler

# Run routing suggestion tests
npm test -- tests/unit/handlers/routing-suggestion.handler.test.ts

# Run journey eligibility tests
npm test -- tests/unit/handlers/journey-eligibility.handler.test.ts

# Run FSM enhanced tests
npm test -- tests/unit/services/fsm.service.enhanced.test.ts
```

**Expected Result**: ALL tests FAIL (handlers and states don't exist)

### Run Integration Tests (requires Testcontainers)

```bash
# Run full integration test suite
npm run test:integration -- tests/integration/journey-submission-flow.integration.test.ts
```

**Expected Result**: Tests FAIL (handlers missing, containers start successfully)

### After Implementation - Verify Tests PASS

```bash
# Run all new tests
npm test -- tests/unit/handlers/routing-suggestion.handler.test.ts \
             tests/unit/handlers/journey-eligibility.handler.test.ts \
             tests/unit/services/fsm.service.enhanced.test.ts

# Run integration tests
npm run test:integration -- tests/integration/journey-submission-flow.integration.test.ts

# Verify coverage thresholds met (≥80% lines/functions/statements, ≥75% branches)
npm run test:coverage
```

**Expected Result**: ALL 53 tests PASS GREEN

---

## Blocking Rules (MANDATORY)

### Test Lock Rule (CRITICAL)

**Blake MUST NOT modify my tests.**

If you believe a test is wrong:
1. Hand back to me with explanation
2. I will review and update the test if needed
3. I will re-hand off the updated failing test

**Why**: The test is the specification - changing it changes the requirement.

### TDD Enforcement

- Tests written FIRST (complete) ✅
- Implementation comes AFTER (Blake's Phase US-3)
- Tests MUST fail initially (RED phase) ✅
- Implementation makes tests GREEN (Blake's goal)
- No test skipping (`it.skip`) allowed
- No coverage exclusions (`/* istanbul ignore */`) allowed

### Coverage Requirements (ADR-014)

**Minimum Thresholds**:
- Lines: ≥80%
- Functions: ≥80%
- Statements: ≥80%
- Branches: ≥75%

**Verification**: `npm run test:coverage` must pass

### Integration Test Requirements (Testing Strategy § 5.2)

**CRITICAL**: At least one integration test MUST exercise REAL @railrepay/* dependencies.

This catches missing transitive dependencies (e.g., node-fetch missing from metrics-pusher).

**Already implemented in**:
```typescript
// tests/integration/journey-submission-flow.integration.test.ts
describe('Coverage: Infrastructure Wiring Tests', () => {
  it('should successfully import and use @railrepay/winston-logger', async () => {
    const { createLogger } = await import('@railrepay/winston-logger');
    // ...
  });
  // Tests for metrics-pusher, postgres-client
});
```

---

## Service Integration Points

### 1. journey-matcher Service

**Base URL**: `process.env.JOURNEY_MATCHER_URL` (e.g., http://journey-matcher.railway.internal:3001)

**Endpoints**:
- `GET /journeys/:id/routes` - Returns ranked route options (used for routing confirmation)
- Response format:
  ```json
  {
    "journeyId": "journey-123",
    "requiresInterchange": true,
    "suggestedRoute": {
      "legs": [
        { "from": "PAD", "to": "BRI", "operator": "GWR", "departure": "10:00", "arrival": "11:30" },
        { "from": "BRI", "to": "CDF", "operator": "GWR", "departure": "11:45", "arrival": "12:15" }
      ],
      "totalDuration": "2h 15m"
    },
    "alternatives": [
      { "number": 1, "legs": [...] },
      { "number": 2, "legs": [...] },
      { "number": 3, "legs": [...] }
    ]
  }
  ```

### 2. eligibility-engine Service

**Base URL**: `process.env.ELIGIBILITY_ENGINE_URL` (e.g., http://eligibility-engine.railway.internal:3006)

**Endpoints**:
- `POST /eligibility/evaluate` - Evaluate journey eligibility (AC-4)
- Request body:
  ```json
  {
    "journeyId": "journey-123",
    "journeyDate": "2024-11-20",
    "origin": "PAD",
    "destination": "CDF"
  }
  ```
- Response format:
  ```json
  {
    "journeyId": "journey-123",
    "isEligible": true,
    "compensationAmount": "£15.00",
    "delayMinutes": 35,
    "tocName": "Great Western Railway",
    "ineligibilityReason": null
  }
  ```

### 3. delay-tracker Service

**Base URL**: `process.env.DELAY_TRACKER_URL` (e.g., http://delay-tracker.railway.internal:3004)

**Endpoints**:
- `POST /journeys/track` - Register future journey for monitoring (AC-5)
- Request body:
  ```json
  {
    "journeyId": "journey-123",
    "userId": "user-456",
    "journeyDate": "2024-11-21",
    "origin": "PAD",
    "destination": "CDF",
    "departureTime": "10:00"
  }
  ```
- Response format:
  ```json
  {
    "trackingId": "tracking-789",
    "message": "Journey registered for monitoring"
  }
  ```

**Webhook (AC-6)**:
- delay-tracker calls whatsapp-handler when delay detected
- Endpoint: `POST /notifications/delay-detected`
- Webhook payload:
  ```json
  {
    "userId": "user-456",
    "journeyId": "journey-123",
    "journeyDate": "2024-11-21",
    "delayMinutes": 45,
    "isEligible": true,
    "compensationAmount": "£25.00"
  }
  ```

---

## Environment Variables Required

Add to `.env` and Railway configuration:

```bash
# Journey matching and routing
JOURNEY_MATCHER_URL=http://journey-matcher.railway.internal:3001

# Eligibility evaluation
ELIGIBILITY_ENGINE_URL=http://eligibility-engine.railway.internal:3006

# Delay tracking
DELAY_TRACKER_URL=http://delay-tracker.railway.internal:3004
```

---

## Error Handling Requirements

### Graceful Degradation

**When external service unavailable**:
- Log error with correlation ID
- Inform user: "We're experiencing technical difficulties. Your journey has been saved and we'll check eligibility later."
- Persist journey data
- Set retry flag in state
- Return to AUTHENTICATED state (don't block user)

**Example**:
```typescript
try {
  const response = await fetch(`${ELIGIBILITY_ENGINE_URL}/eligibility/evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-ID': ctx.correlationId,
    },
    body: JSON.stringify({ journeyId }),
    timeout: 5000, // 5-second timeout
  });
} catch (error) {
  logger.error('Eligibility engine unavailable', {
    correlationId: ctx.correlationId,
    journeyId,
    error,
  });
  return {
    response: "We're checking your journey eligibility now. We'll message you shortly with the result.",
    nextState: FSMState.AUTHENTICATED,
    stateData: { eligibilityCheckPending: true },
  };
}
```

### Validation

**User input validation**:
- Accept "1", "2", "3", "NONE" for alternative selection (case insensitive)
- Accept "YES", "NO" for routing confirmation (case insensitive)
- Reject all other input with helpful error message

**Data validation**:
- Verify journeyId exists in state before API calls
- Validate API response structure before processing
- Handle missing or null fields gracefully

---

## Observability Requirements

### Logging (Winston with Correlation IDs)

**Required logs**:
```typescript
logger.info('Routing confirmation required', {
  correlationId: ctx.correlationId,
  journeyId,
  origin,
  destination,
  interchangeRequired: true,
});

logger.info('User confirmed routing', {
  correlationId: ctx.correlationId,
  journeyId,
  selectedRoute: 'suggested',
});

logger.info('Eligibility check complete', {
  correlationId: ctx.correlationId,
  journeyId,
  isEligible: true,
  compensationAmount: '£15.00',
});

logger.error('Eligibility engine timeout', {
  correlationId: ctx.correlationId,
  journeyId,
  error,
});
```

### Metrics (Prometheus)

**Required metrics**:
```typescript
// Routing workflow
routing_confirmations_total{status="accepted"|"rejected"}
routing_alternatives_requested_total
routing_escalations_total

// Eligibility checks
eligibility_checks_total{result="eligible"|"ineligible"}
eligibility_check_duration_seconds

// Tracking
future_journeys_tracked_total
proactive_notifications_sent_total{result="eligible"|"ineligible"}
```

### Outbox Events

**Published events** (via whatsapp_handler.outbox_events table):
- `journey.routing_escalation` - Max alternatives exceeded
- `journey.eligibility_confirmed` - Historic journey eligibility result
- `journey.tracking_registered` - Future journey tracking started
- `journey.delay_notification_sent` - Proactive notification delivered

**Event structure**:
```typescript
{
  id: uuid(),
  aggregate_id: journeyId,
  aggregate_type: 'journey',
  event_type: 'journey.eligibility_confirmed',
  payload: {
    journeyId,
    userId,
    isEligible: true,
    compensationAmount: '£15.00',
    delayMinutes: 35,
  },
  published_at: null,
  created_at: NOW(),
}
```

---

## Phase US-3 Implementation Checklist

Blake must complete these tasks to make tests GREEN:

- [ ] Add AWAITING_ROUTING_CONFIRM and AWAITING_ROUTING_ALTERNATIVE to FSMState enum
- [ ] Update FSM state count comment (11 → 13)
- [ ] Create `src/handlers/routing-suggestion.handler.ts`
  - [ ] Handle YES/NO for routing confirmation
  - [ ] Fetch suggested route from journey-matcher
  - [ ] Format route message with leg details
  - [ ] Transition to correct next state
- [ ] Create `src/handlers/routing-alternative.handler.ts`
  - [ ] Present 3 numbered alternatives
  - [ ] Handle selection (1, 2, 3, NONE)
  - [ ] Track alternativeCount correctly
  - [ ] Escalate after max 3 rejections
- [ ] Create `src/handlers/journey-eligibility.handler.ts`
  - [ ] Detect historic vs future journey
  - [ ] Call eligibility-engine for historic journeys
  - [ ] Call delay-tracker for future journeys
  - [ ] Implement sendDelayNotification for AC-6
- [ ] Register new handlers in `src/handlers/index.ts`
- [ ] Add environment variables (JOURNEY_MATCHER_URL, etc.)
- [ ] Implement error handling and graceful degradation
- [ ] Add Winston logging with correlation IDs
- [ ] Add Prometheus metrics
- [ ] Publish outbox events for all workflows

**Verification**:
- [ ] All 53 tests PASS GREEN
- [ ] Coverage thresholds met (≥80%/≥75%)
- [ ] `npm run build` succeeds
- [ ] `npm run lint` succeeds
- [ ] Integration tests pass with Testcontainers

---

## Next Steps

1. **Blake**: Review this handoff package and test files
2. **Blake**: Ask clarifying questions if test behavior is unclear
3. **Blake**: Implement handlers to make tests GREEN (Phase US-3)
4. **Blake**: Verify all tests pass and coverage met
5. **Blake**: Hand off to Jessie for Phase US-4 (QA verification and sign-off)

---

## Questions for Blake

If you have questions about test behavior or requirements:
1. Read the test file comments - they explain the expected behavior
2. Check the CONTEXT comments in test setup - they explain the workflow
3. Review the assertions - they define success criteria
4. If still unclear, hand back to me with specific questions (DO NOT modify tests)

---

**Phase US-2 Status**: ✅ COMPLETE
**Tests Written**: 53
**Tests Passing**: 0 (RED phase - ready for implementation)
**Ready for Phase US-3**: YES

---

**Jessie (QA Engineer)**
Phase US-2: Test Specification Complete
