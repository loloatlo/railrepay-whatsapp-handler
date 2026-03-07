# TD-059 Phase TD-1: Test Specification

**Backlog Item**: BL-140 (TD-WHATSAPP-059)
**Service**: whatsapp-handler
**Domain**: User Channels
**Date**: 2026-02-10
**Status**: TD-1 Complete → Hand off to Blake for TD-2

---

## Test Specification Summary

Five new failing tests added to `tests/unit/handlers/ticket-upload.handler.test.ts` to verify that `tripId` is included in the `journey.created` outbox event leg payload.

### Test Coverage by Acceptance Criteria

| AC | Test Case | Status |
|----|-----------|--------|
| AC-1 | Should include tripId in each leg when present in stateData | ❌ FAILING (expected) |
| AC-1 | Should read tripId from matchedRoute when confirmedRoute is absent | ❌ FAILING (expected) |
| AC-2 | Should default tripId to null when absent from stateData legs | ❌ FAILING (expected) |
| AC-2 | Should include tripId field in mixed scenario (some with, some without) | ❌ FAILING (expected) |
| AC-4 | Should include tripId alongside all existing leg fields | ❌ FAILING (expected) |

### Test Results

```
Test Files  1 failed (1)
     Tests  5 failed | 7 passed (12)
```

**AC-3 VERIFIED**: All 7 existing tests continue to pass (no regressions).

### Failure Reason (Expected)

All new tests fail with:
```
AssertionError: expected { from: 'PAD', to: 'RDG', …(3) } to have property "tripId"
```

This confirms the current implementation only maps 5 fields (`from`, `to`, `departure`, `arrival`, `operator`) and omits `tripId`.

---

## Test Design Decisions

### 1. Behavior-Focused Tests

Tests verify the WHAT (tripId appears in outbox event payload) without dictating HOW the implementation adds it. Blake has freedom to implement as long as the payload structure is correct.

### 2. Realistic Test Data

All test contexts include realistic leg data with actual CRS codes (PAD, RDG, OXF, BHM), operators (GWR, CHR), and Darwin RID formats (`202411201000001`).

### 3. Edge Case Coverage

- **Happy path**: All legs have tripId
- **Legacy path**: No legs have tripId (defaults to null)
- **Mixed path**: Some legs have tripId, some don't
- **Alternative state data**: Tests both `confirmedRoute` and `matchedRoute` sources

### 4. Standard Matchers Only

All assertions use standard Vitest matchers:
- `toHaveProperty()` - Verifies field existence
- `toBe()` - Verifies exact values
- `toBeNull()` - Verifies null fallback

---

## Test Structure

### Test File Location
`tests/unit/handlers/ticket-upload.handler.test.ts`

### New Test Suite
```typescript
describe('TD-WHATSAPP-059: tripId field in journey.created event', () => {
  // 5 test cases covering AC-1, AC-2, AC-4
});
```

### Test Pattern
Each test:
1. Sets up `mockContext` with `stateData` containing `confirmedRoute` or `matchedRoute`
2. Includes legs with realistic data (CRS codes, times, operators, tripIds)
3. Calls `ticketUploadHandler(mockContext)`
4. Extracts `result.publishEvents[0]` (the journey.created event)
5. Asserts on `event.payload.legs[n].tripId`

---

## Handoff to Blake (Phase TD-2)

### Implementation Required

**File**: `src/handlers/ticket-upload.handler.ts`
**Lines**: 86-92

Add `tripId: leg.tripId || null` to the leg mapping:

```typescript
// CURRENT (lines 86-92):
payload.legs = matchedRoute.legs.map((leg: any) => ({
  from: leg.from,
  to: leg.to,
  departure: leg.departure,
  arrival: leg.arrival,
  operator: leg.operator,
}));

// REQUIRED:
payload.legs = matchedRoute.legs.map((leg: any) => ({
  from: leg.from,
  to: leg.to,
  departure: leg.departure,
  arrival: leg.arrival,
  operator: leg.operator,
  tripId: leg.tripId || null, // ← Add this line
}));
```

### Verification

After implementation, run:
```bash
npm test -- tests/unit/handlers/ticket-upload.handler.test.ts
```

Expected result:
```
Test Files  1 passed (1)
     Tests  12 passed (12)
```

All 12 tests (7 existing + 5 new) should pass.

---

## Test Lock Rule

**BLOCKING**: Blake MUST NOT modify the test file. If Blake believes a test is incorrect, Blake must hand back to Jessie with explanation.

The tests define the specification. Changing the tests changes the requirement.

---

## Next Steps

1. **Blake (TD-2)**: Implement the single-line fix to add `tripId: leg.tripId || null` to leg mapping
2. **Blake (TD-2)**: Verify all 12 tests pass
3. **Blake (TD-2)**: Run `npm run test:coverage` to verify no coverage regression
4. **Blake (TD-2)**: Hand back to Jessie for QA (Phase TD-3)

---

**Status**: ✅ TD-1 Complete - Failing tests ready for Blake
