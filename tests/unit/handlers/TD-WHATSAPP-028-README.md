# TD-WHATSAPP-028: Journey-Matcher Integration Test Specification

**Phase**: TD-1 (Test Specification) - COMPLETED
**Test Lock Status**: 🔒 LOCKED - Blake MUST NOT modify these tests without approval

---

## Technical Debt Summary

**TD Item**: TD-WHATSAPP-028 - Journey-Matcher Integration Mocked
**Severity**: 🟡 Medium Priority
**Service**: whatsapp-handler
**Handler**: `routing-suggestion.handler.ts`

**Current State**:
- Hardcoded mock routes in handler (lines 24-32)
- No HTTP client call to journey-matcher service
- No environment variable configuration
- No error handling for journey-matcher failures

**Required Fix**:
- Replace hardcoded routes with real HTTP client call
- Add `JOURNEY_MATCHER_URL` environment variable
- Implement error handling for 404, 500, timeout scenarios
- Propagate correlation IDs per ADR-002

---

## Test File Location

`/services/whatsapp-handler/tests/unit/handlers/routing-suggestion.handler.integration.test.ts`

---

## Acceptance Criteria Coverage

| AC # | Criterion | Test Count | Status |
|------|-----------|------------|--------|
| AC-1 | HTTP call to journey-matcher API | 3 tests | ❌ FAILING |
| AC-2 | Display data from journey-matcher response | 3 tests | ❌ FAILING |
| AC-3 | Graceful error handling for unavailability | 4 tests | ❌ FAILING |
| AC-4 | JOURNEY_MATCHER_URL environment variable | 2 tests | ❌ FAILING |
| AC-5 | Correlation ID propagation | 2 tests | ❌ FAILING |
| **Integration** | Full end-to-end flow | 1 test | ❌ FAILING |

**Total**: 15 tests, all FAILING as expected per TDD

---

## Test Naming Convention

Per TD Remediation guidelines:

```typescript
describe('TD-WHATSAPP-028: Journey-Matcher Integration (Real HTTP Client)', () => {
  /**
   * TD CONTEXT: Hardcoded mock routes prevent integration with journey-matcher
   * REQUIRED FIX: Replace with real HTTP client call to journey-matcher API
   */
  it('should [expected behavior] when [condition] (currently: [broken behavior])', () => {});
});
```

---

## Key Test Scenarios

### AC-1: HTTP Call to Journey-Matcher API

1. **should make GET request to journey-matcher /journeys/:id/routes endpoint**
   - Currently: No HTTP call made, hardcoded routes used
   - Expected: `axios.get` called with journey-matcher URL

2. **should use JOURNEY_MATCHER_URL environment variable to construct API URL**
   - Currently: No environment variable
   - Expected: `process.env.JOURNEY_MATCHER_URL` used as base URL

3. **should extract journeyId from context stateData for API call**
   - Currently: Hardcoded `journey-456`
   - Expected: Read from `ctx.stateData.journeyId`

### AC-2: Display Data from Journey-Matcher Response

1. **should display route legs from journey-matcher response in message**
   - Currently: Shows hardcoded PAD → BRI → CDF
   - Expected: Shows actual route from API (e.g., PAD → RDG → CDF)

2. **should display all route legs when journey has multiple interchanges**
   - Currently: Hardcoded 2-leg display
   - Expected: Dynamic N-leg display from API

3. **should store journey route data in stateData for later confirmation**
   - Currently: Stores hardcoded `suggestedRoute`
   - Expected: Stores API response in `stateData.suggestedRoute`

### AC-3: Graceful Error Handling

1. **should return user-friendly error message when journey-matcher returns 404**
   - Expected: "unable to find journey" message, transition to ERROR state

2. **should return user-friendly error message when journey-matcher times out**
   - Expected: "service unavailable" message, transition to ERROR state

3. **should return user-friendly error message when journey-matcher returns 500**
   - Expected: "temporarily unavailable" (do NOT expose HTTP 500 to user)

4. **should log error details with correlation ID when journey-matcher fails**
   - Expected: Winston logger called with error details and correlationId

### AC-4: Environment Variable Configuration

1. **should throw error when JOURNEY_MATCHER_URL is not configured**
   - Expected: Clear error message on startup or first API call

2. **should use JOURNEY_MATCHER_URL from environment for all API calls**
   - Expected: Single source of truth for base URL

### AC-5: Correlation ID Propagation (ADR-002)

1. **should include X-Correlation-ID header in journey-matcher request**
   - Expected: `X-Correlation-ID` header included with value from `ctx.correlationId`

2. **should propagate unique correlation ID for each request**
   - Expected: Each request uses its own correlationId from context

### Integration: Full Flow

1. **should complete full flow: API call → display routes → store state → transition**
   - End-to-end verification of complete integration

---

## Test Data Design

Per ADR-017 (Test Fixtures), these tests use **differentiating test data** to ensure the handler uses real API responses, not hardcoded data:

| Scenario | Hardcoded Data | Test API Data | Differentiator |
|----------|----------------|---------------|----------------|
| Route legs | PAD → BRI → CDF | PAD → RDG → CDF | Interchange station (BRI vs RDG) |
| Departure time | 10:00 | 09:00 | Departure time differs |
| Total duration | 2h 15m | 3h 0m | Duration differs |
| N-leg journey | 2 legs | 3 legs | Number of legs differs |

**Why this matters**: If the test passes with identical data, it could be using hardcoded routes. By using different data, we prove the handler reads from the API.

---

## Mocking Strategy

Per Jessie Guidelines (Phase 3.1):

1. **Interface-based mocking**: Mock `axios` HTTP client, not internal handler functions
2. **Standard Vitest matchers**: No custom matchers like `toBeOneOf()`
3. **No placeholder assertions**: All assertions are completable by Blake
4. **Behavior-focused**: Test WHAT the system should do, not HOW

```typescript
// Mock axios at module level
vi.mock('axios');

// Mock winston logger to prevent runtime errors
vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));
```

---

## Expected Test Results (Current State)

```
❯ TD-WHATSAPP-028: Journey-Matcher Integration (15 tests | 15 failed)
  ❯ AC-1: HTTP Call to Journey-Matcher API (3 failed)
    ✗ should make GET request to journey-matcher
      → expected axios.get to be called 1 times, but got 0 times
    ✗ should use JOURNEY_MATCHER_URL environment variable
      → expected axios.get to be called, but got 0 calls
    ✗ should extract journeyId from context stateData
      → expected axios.get to be called, but got 0 calls

  ❯ AC-2: Display Data from Journey-Matcher Response (3 failed)
    ✗ should display route legs from API response
      → expected response to contain 'RDG', got 'BRI' (hardcoded)
    ✗ should display all route legs for N-leg journeys
      → expected response to contain 'RDG', got 'BRI' (hardcoded)
    ✗ should store API route data in stateData
      → expected 'SWA', got 'BRI' (hardcoded)

  ❯ AC-3: Graceful Error Handling (4 failed)
    ✗ should handle 404 from journey-matcher
      → expected 'unable to find', got hardcoded route response
    ✗ should handle timeout from journey-matcher
      → expected 'service unavailable', got hardcoded route response
    ✗ should handle 500 from journey-matcher
      → expected 'temporarily unavailable', got hardcoded route response
    ✗ should log errors with correlation ID
      → expected logger.error to be called, but got 0 calls

  ❯ AC-4: Environment Variable Configuration (2 failed)
    ✗ should throw error when JOURNEY_MATCHER_URL not set
      → promise resolved instead of rejecting
    ✗ should use JOURNEY_MATCHER_URL from environment
      → expected axios.get to be called, but got 0 calls

  ❯ AC-5: Correlation ID Propagation (2 failed)
    ✗ should include X-Correlation-ID header
      → expected axios.get to be called with header, but got 0 calls
    ✗ should propagate unique correlation IDs
      → expected axios.get to be called, but got 0 calls

  ❯ Integration: Full Flow (1 failed)
    ✗ should complete full API call → display → store → transition
      → expected axios.get to be called, but got 0 calls
```

**This is EXPECTED per TDD** - tests fail first, proving the gap exists.

---

## Handoff to Blake (Phase TD-2)

### Implementation Requirements

Blake must implement the following WITHOUT modifying the test file (Test Lock Rule):

1. **HTTP Client Integration**:
   - Add `axios` import to `routing-suggestion.handler.ts`
   - Make GET request to `${JOURNEY_MATCHER_URL}/journeys/${journeyId}/routes`
   - Extract `journeyId` from `ctx.stateData.journeyId`

2. **Environment Variable**:
   - Add `JOURNEY_MATCHER_URL` to environment variables
   - Validate it exists at startup or throw clear error
   - Update `.env.template` with example value

3. **Response Handling**:
   - Parse journey-matcher API response
   - Display route legs dynamically (support N legs, not just 2)
   - Store API response in `stateData.suggestedRoute`

4. **Error Handling**:
   - Catch 404: "unable to find journey" → ERROR state
   - Catch timeout: "service unavailable" → ERROR state
   - Catch 500: "temporarily unavailable" → ERROR state
   - Log all errors with correlation ID via Winston

5. **Correlation ID Propagation**:
   - Include `X-Correlation-ID: ${ctx.correlationId}` header in HTTP request

6. **Documentation**:
   - Update README.md with `JOURNEY_MATCHER_URL` documentation
   - Add to Railway service environment variables

### Files to Modify

- `/services/whatsapp-handler/src/handlers/routing-suggestion.handler.ts` (main implementation)
- `/services/whatsapp-handler/.env.template` (environment variable documentation)
- `/services/whatsapp-handler/README.md` (deployment guide)

### Files Blake MUST NOT Modify (Test Lock Rule)

- ❌ `/services/whatsapp-handler/tests/unit/handlers/routing-suggestion.handler.integration.test.ts`

If Blake believes a test is incorrect, Blake MUST hand back to Jessie with explanation. Jessie will review and update the test if needed.

---

## QA Verification (Phase TD-3)

After Blake implements, Jessie will verify:

1. ✅ All 15 tests pass
2. ✅ No test modifications made by Blake (Test Lock Rule compliance)
3. ✅ Coverage thresholds maintained (≥80% lines/functions/statements, ≥75% branches)
4. ✅ No anti-gaming patterns (`istanbul ignore`, `it.skip`)
5. ✅ Service health checks pass (`npm test`, `npm run build`, `npm run lint`)
6. ✅ Integration test exercises REAL axios HTTP client (not mocked in implementation)
7. ✅ `JOURNEY_MATCHER_URL` documented in README and `.env.template`

---

## References

- **ADR-014**: TDD Discipline (tests written BEFORE implementation)
- **ADR-017**: Test Fixtures (differentiating test data required)
- **ADR-002**: Correlation ID Propagation
- **Notion**: Testing Strategy 2.0 (Test Lock Rule)
- **CLAUDE.md**: Technical Debt Remediation Workflow (TD-0 to TD-5)

---

**Test Lock Status**: 🔒 These tests are now LOCKED for Blake's implementation phase.
**Next Phase**: Blake (TD-2 Implementation) - Make these tests GREEN.
