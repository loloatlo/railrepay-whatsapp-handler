# TD-059 Phase TD-0: Specification

**Backlog Item**: BL-140 (TD-WHATSAPP-059)
**Service**: whatsapp-handler
**Domain**: User Channels
**Date**: 2026-02-10
**Status**: TD-0 Complete

---

## Problem Summary

whatsapp-handler's `ticket-upload.handler.ts` maps journey legs into the `journey.created` outbox event payload (lines 86-92) but does NOT include the `tripId` field. journey-matcher's API now returns `tripId` in each leg (as of TD-JOURNEY-MATCHER-006), but when whatsapp-handler passes the journey data downstream via the outbox event, `tripId` is dropped.

Without this field, journey-matcher's `ticket-uploaded.handler` cannot extract real Darwin RIDs from whatsapp-handler-originated journeys, falling back to `null` RID.

## Root Cause

The leg mapping object at line 86-92 of `src/handlers/ticket-upload.handler.ts` explicitly maps only 5 fields (`from`, `to`, `departure`, `arrival`, `operator`) and omits `tripId`.

## Fix Location

**File**: `src/handlers/ticket-upload.handler.ts`
**Lines**: 86-92

```typescript
// CURRENT (line 86-92):
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
  tripId: leg.tripId || null,
}));
```

## Acceptance Criteria

- [x] AC-1: `ticket-upload.handler.ts` leg mapping includes `tripId: leg.tripId || null`
- [x] AC-2: `journey.created` outbox event payload contains `tripId` in each leg object
- [x] AC-3: Existing whatsapp-handler tests continue to pass (no regressions)
- [x] AC-4: Unit test asserting `tripId` is present in the outbox event leg payload

## Verification Methods

| AC | Method |
|----|--------|
| AC-1 | Code review of ticket-upload.handler.ts |
| AC-2 | Unit test asserting outbox payload structure includes tripId |
| AC-3 | Full test suite passes (`npm test`) |
| AC-4 | New unit test in ticket-upload.handler.test.ts |

## Scope Assessment

- **Files affected**: 1 source file, 1 test file
- **Schema changes**: None (no Hoops needed)
- **ADR needed**: No
- **Risk**: Very low -- single field addition with null fallback

## Dependencies

- TD-JOURNEY-MATCHER-006 deployed (DONE -- commit 7ec5b43)
- No schema changes required

## Existing Test File

`tests/unit/handlers/ticket-upload.handler.test.ts` -- 94 lines, 7 tests. Existing tests do NOT assert on individual leg fields in the outbox event payload. Jessie will need to add tests that:

1. Assert `tripId` is included in each leg of the outbox event payload when present in stateData
2. Assert `tripId` defaults to `null` when absent from stateData legs (legacy routes)

## Workflow

| Phase | Agent | Status |
|-------|-------|--------|
| TD-0 | Quinn | COMPLETE |
| TD-1 | Jessie | PENDING |
| TD-2 | Blake | PENDING |
| TD-3 | Jessie | PENDING |
| TD-4 | Moykle | PENDING |
| TD-5 | Quinn | PENDING |
