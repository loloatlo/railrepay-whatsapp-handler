# TD-WHATSAPP-034: Phase TD-1 Complete - Handoff to Blake (Phase TD-2)

## Status: FAILING TESTS READY FOR IMPLEMENTATION

**Phase**: TD-1 (Test Impact) → TD-2 (Implementation)
**Agent**: Jessie QA Engineer → Blake Backend Engineer
**Date**: 2026-01-24

---

## Summary

I have completed Phase TD-1 (Test Impact) for TD-WHATSAPP-034. All tests are now written and FAILING as expected, proving the bug exists.

**Bug**: `journey-confirm.handler.ts` transitions directly to `AWAITING_TICKET_UPLOAD`, bypassing the routing flow.

**Fix Required**: Change transition to `AWAITING_ROUTING_CONFIRM` and preserve journey data in stateData.

---

## Test Files Modified/Created

### 1. Unit Test (UPDATED)
**File**: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/tests/unit/handlers/journey-confirm.handler.test.ts`

**Changes Made**:
- Updated expected nextState from `AWAITING_TICKET_UPLOAD` to `AWAITING_ROUTING_CONFIRM` (lines 37-51)
- Added test to verify stateData preservation for routing handler (lines 53-72)
- Updated response assertion to check for "routing" instead of "ticket"

**Current Failures**:
```
✗ should accept "YES" and transition to routing confirmation
  Expected response to contain: "routing"
  Received: "Perfect! Now please send a photo of your ticket..."

✗ should accept "yes" (lowercase)
  Expected nextState: AWAITING_ROUTING_CONFIRM
  Received: AWAITING_TICKET_UPLOAD

✗ should preserve journey data in stateData for routing handler
  Expected stateData to be defined
  Received: undefined
```

### 2. Integration Test (CREATED)
**File**: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/tests/integration/journey-confirm-routing-flow.test.ts`

**Test Coverage**:
1. **FSM State Transition Flow**
   - Verifies transition from `AWAITING_JOURNEY_CONFIRM` to `AWAITING_ROUTING_CONFIRM`
   - Verifies journey data preservation in stateData
   - Tests full end-to-end flow: confirm → routing check → ticket upload

2. **Edge Cases**
   - Missing stateData fields in routing handler
   - Missing stateData entirely

3. **Regression Test**
   - Prevents future reintroduction of the bug
   - Explicitly asserts nextState should NOT be `AWAITING_TICKET_UPLOAD`

**Current Failures**:
```
✗ should transition from AWAITING_JOURNEY_CONFIRM to AWAITING_ROUTING_CONFIRM
  Expected: AWAITING_ROUTING_CONFIRM
  Received: AWAITING_TICKET_UPLOAD

✗ should preserve journey data in stateData for routing handler to use
  Expected stateData to be defined
  Received: undefined

✗ should complete full flow: confirm YES → routing check → ticket upload
  Expected confirmResult.nextState: AWAITING_ROUTING_CONFIRM
  Received: AWAITING_TICKET_UPLOAD

✗ should NOT transition directly to AWAITING_TICKET_UPLOAD
  Expected result.nextState NOT to be: AWAITING_TICKET_UPLOAD
  Received: AWAITING_TICKET_UPLOAD
```

---

## Expected Behavior (What Tests Validate)

### 1. State Transition Change
**Current (WRONG)**:
```typescript
if (input === 'YES') {
  return {
    response: 'Perfect! Now please send a photo of your ticket...',
    nextState: FSMState.AWAITING_TICKET_UPLOAD, // ❌ WRONG
  };
}
```

**Expected (CORRECT)**:
```typescript
if (input === 'YES') {
  return {
    response: 'Perfect! Let me check the routing for your journey...',
    nextState: FSMState.AWAITING_ROUTING_CONFIRM, // ✅ CORRECT
    stateData: {
      journeyId: ctx.stateData?.journeyId,
      origin: ctx.stateData?.origin,
      destination: ctx.stateData?.destination,
      travelDate: ctx.stateData?.travelDate,
      departureTime: ctx.stateData?.departureTime,
    },
  };
}
```

### 2. StateData Preservation
The routing-suggestion.handler REQUIRES these fields from stateData:
- `journeyId` (string)
- `origin` (string - station code or name)
- `destination` (string - station code or name)
- `travelDate` (string - ISO date format)
- `departureTime` (string - HH:MM format)

**Why**: routing-suggestion.handler uses these fields to call the journey-matcher API:
```typescript
const apiUrl = `${journeyMatcherUrl}/routes?from=${origin}&to=${destination}&date=${travelDate}&time=${departureTime}`;
```

If these fields are missing, routing-suggestion.handler will transition to `ERROR` state.

### 3. FSM Flow Verification
Tests verify the CORRECT flow:
```
AWAITING_JOURNEY_CONFIRM + "YES"
  ↓
journey-confirm.handler
  ↓ (transitions to AWAITING_ROUTING_CONFIRM with stateData)
FSM Service
  ↓
routing-suggestion.handler (calls journey-matcher API)
  ↓ (transitions to AWAITING_ROUTING_CONFIRM and shows routing)
User confirms routing with "YES"
  ↓
routing-suggestion.handler
  ↓ (transitions to AWAITING_TICKET_UPLOAD)
FSM Service
  ↓
ticket-upload.handler
```

---

## Files Blake Should Modify (Phase TD-2)

### PRIMARY FILE
**File**: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/src/handlers/journey-confirm.handler.ts`

**Line 14-26**: Update the "YES" confirmation block

**Required Changes**:
1. Change `nextState` from `FSMState.AWAITING_TICKET_UPLOAD` to `FSMState.AWAITING_ROUTING_CONFIRM`
2. Update `response` text to mention routing (instead of ticket upload)
3. Add `stateData` field to return value with journey fields from `ctx.stateData`

**Fields to Preserve** (from `ctx.stateData`):
- `journeyId`
- `origin`
- `destination`
- `travelDate`
- `departureTime`

---

## Test Lock Rule Reminder

**Blake MUST NOT modify the test files.**

If Blake believes a test is incorrect:
1. Blake hands back to Jessie with explanation
2. Jessie reviews and updates the test if needed
3. Jessie re-hands off the updated failing test

The tests define the specification. Changing tests = changing requirements.

---

## Test Verification Commands

After Blake implements the fix, run these commands to verify:

```bash
# Run unit tests
npm test -- tests/unit/handlers/journey-confirm.handler.test.ts

# Run integration tests
npm test -- tests/integration/journey-confirm-routing-flow.test.ts

# Run full test suite
npm test
```

**Expected Result**: All tests should PASS after Blake's implementation.

---

## Success Criteria (Phase TD-2 Complete)

Blake's implementation is complete when:

1. ✅ All unit tests in `journey-confirm.handler.test.ts` PASS
2. ✅ All integration tests in `journey-confirm-routing-flow.test.ts` PASS
3. ✅ No existing tests broken (regression check)
4. ✅ `npm run build` succeeds
5. ✅ `npm run lint` succeeds

After all tests pass, Blake hands off to Jessie for Phase TD-3 (QA Sign-off).

---

## Additional Context

### Why This Bug Existed

The journey-confirm handler was implemented before the routing flow was added. When routing functionality (AC-2, AC-3 from User Story) was implemented, the journey-confirm handler was not updated to route through the new routing-suggestion.handler.

### Impact

Users with journeys requiring interchanges would skip the routing confirmation step, meaning:
- No routing validation occurred
- No alternative routes could be suggested
- Data flow to routing-suggestion.handler was broken

### Related Files (READ ONLY - Do Not Modify)

- `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/src/handlers/routing-suggestion.handler.ts` - Shows what fields are required in stateData
- `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/src/services/fsm.service.ts` - Shows FSM states and transitions
- `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/src/handlers/index.ts` - Shows handler registry

---

## Ready for Blake (Phase TD-2)

**Status**: ✅ READY
**Blocking Issues**: None
**Test Suite Status**: 7 unit test failures, 4 integration test failures (all expected)
**Next Agent**: Blake Backend Engineer
**Next Phase**: TD-2 (Implementation)

---

**Jessie QA Engineer**
Phase TD-1 Complete - 2026-01-24
