# TD Remediation Specification: BL-29 (TD-WHATSAPP-030)

## Eligibility-Engine Integration — Replace Mocked Responses with Real HTTP Calls

**Backlog Item**: BL-29
**Origin**: TD-WHATSAPP-030
**Type**: Tech Debt
**Service**: whatsapp-handler
**Domain**: User Channels
**Status**: In Progress
**Date**: 2026-04-12

---

## Problem Statement

`journey-eligibility.handler.ts` uses mock eligibility responses (`mockEligibilityResponse` read from context) instead of calling the real eligibility-engine API. Users currently receive fake eligibility results with hardcoded data — no actual compensation calculation occurs.

Additionally, the handler uses a hardcoded date string (`const today = '2024-11-20'`) instead of computing the current date dynamically.

## Root Cause

The handler was written during initial Phase 3.2 before the eligibility-engine service was deployed. Mock responses were used as a placeholder to satisfy Jessie's test expectations. The integration was never wired up.

---

## Target Architecture

**Current flow (mocked)**:
```
User submits journey → handler reads mockEligibilityResponse from ctx → returns fake result
```

**Target flow (real)**:
```
User submits journey → handler calls POST /eligibility/evaluate on eligibility-engine → maps response → returns real result
```

### Eligibility-Engine API Contract

**Endpoint**: `POST /eligibility/evaluate`
**Production URL**: `https://railrepay-eligibility-engine-production.up.railway.app`
**Internal URL**: `http://eligibility-engine.railway.internal:3006` (Railway private networking)

**Request body** (required fields for this integration):
```json
{
  "journey_id": "uuid",
  "toc_code": "string (max 5 chars)",
  "delay_minutes": 35,
  "ticket_fare_pence": 2500
}
```

**Response** (200 OK):
```json
{
  "journey_id": "uuid",
  "eligible": true,
  "scheme": "DR15",
  "delay_minutes": 35,
  "compensation_percentage": 25,
  "compensation_pence": 625,
  "ticket_fare_pence": 2500,
  "reasons": ["Delay of 35 minutes qualifies for 25% refund under DR15 scheme"],
  "applied_rules": ["DR15_30MIN_25PCT"],
  "evaluation_timestamp": "2026-04-12T10:00:00.000Z"
}
```

**Error cases**:
- 400: Validation error (missing required fields, unknown TOC code)
- 503/5xx: Service unavailable (handler should fall back gracefully)
- Timeout: Network timeout (handler should fall back gracefully)

### Environment Variable

```
ELIGIBILITY_ENGINE_URL=http://eligibility-engine.railway.internal:3006
```

Default for local dev: `http://localhost:3006`

---

## Scope of Changes

### Files to Modify

1. **`src/handlers/journey-eligibility.handler.ts`** — Primary change target
   - Remove `mockEligibilityResponse` consumption from context
   - Add HTTP call to eligibility-engine using existing `createHttpClient()` from `src/utils/http-client.ts`
   - Replace hardcoded `const today = '2024-11-20'` with dynamic date
   - Map eligibility-engine response fields to user message
   - Preserve graceful fallback when service is unavailable

### Files NOT to Modify (Test Lock Rule)

- `tests/unit/handlers/journey-eligibility.handler.test.ts` — Jessie owns this file. Blake MUST NOT modify it.

### New Files (Potentially)

- `src/services/eligibility-client.service.ts` — Thin wrapper around `createHttpClient()` for eligibility-engine calls (follows `ocr-client.service.ts` pattern)

### Reference Patterns

- **HTTP client**: `src/utils/http-client.ts` (retry + circuit breaker)
- **Service client pattern**: `src/services/ocr-client.service.ts` (env var, timeout, structured logging)
- **Correlation ID passing**: Already exists in handler via `ctx.correlationId`

---

## Acceptance Criteria (from BL-29)

- [ ] AC-1: journey-eligibility.handler.ts makes a real HTTP call to eligibility-engine POST /eligibility/evaluate
- [ ] AC-2: HTTP call sends required fields: journey_id, toc_code, delay_minutes, ticket_fare_pence
- [ ] AC-3: Handler maps eligibility-engine response into user-facing messages
- [ ] AC-4: Graceful fallback when eligibility-engine is unreachable
- [ ] AC-5: URL configurable via ELIGIBILITY_ENGINE_URL env var
- [ ] AC-6: X-Correlation-ID header included in all calls
- [ ] AC-7: Hardcoded date replaced with dynamic current date
- [ ] AC-8: Existing tests continue to pass (Test Lock Rule)
- [ ] AC-9: Coverage >= 80% lines/functions/statements, >= 75% branches

---

## Data Impact Analysis

**No schema changes required.** This is a pure integration wiring change in whatsapp-handler. The eligibility-engine schema and API are already deployed and operational. No Hoops (Phase TD-0.5) involvement needed.

---

## Test Strategy

### Jessie (Phase TD-1): Test Updates

Jessie needs to update/create tests that:
1. Mock the HTTP client (not the eligibility-engine service) at the `createHttpClient` or `axios` boundary
2. Verify the handler sends correct payload to eligibility-engine
3. Verify response mapping from eligibility-engine format to WhatsApp message format
4. Verify fallback behavior on HTTP errors/timeouts
5. Verify correlation ID is passed through
6. Verify environment variable is read for URL configuration

**Important**: The existing tests use `mockEligibilityResponse` injected via context. The new tests should mock at the HTTP client level instead, verifying that a real HTTP call would be made.

### Blake (Phase TD-2): Implementation

Blake will:
1. Create `eligibility-client.service.ts` following the `ocr-client.service.ts` pattern
2. Modify `journey-eligibility.handler.ts` to use the eligibility client
3. Replace hardcoded date with `new Date()`
4. Ensure all existing tests pass (Test Lock Rule)
5. Make Jessie's new tests pass

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Existing tests break due to mock pattern change | Medium | High | Jessie updates tests first (TDD); Blake must not modify Jessie's tests |
| stateData missing toc_code or ticket_fare_pence | High | Medium | Handler must handle missing fields gracefully (fallback or default) |
| eligibility-engine response format mismatch | Low | Medium | API contract verified from app.ts source code |

---

## Workflow Sequence

```
Quinn (TD-0: This spec) ✅ COMPLETE
    ↓
[TD-0.5: Hoops — SKIPPED, no data layer impact]
    ↓
Jessie (TD-1: Write/update tests for real HTTP integration)
    ↓
Blake (TD-2: Implement eligibility-client.service.ts, wire handler)
    ↓
Jessie (TD-3: QA sign-off — coverage, all ACs verified)
    ↓
Moykle (TD-4: Deploy to Railway)
    ↓
Quinn (TD-5: Verify deployment, update Backlog, Changelog)
```

---

## Notes

- The `sendDelayNotification` function in the same file is a separate concern (proactive notifications). It is NOT part of this TD item's scope — it was implemented for BL-148.
- The `mockDelayTrackerResponse` pattern for future journeys is a SEPARATE tech debt item (delay-tracker integration). Do not address it in this TD.
- The `toc_code` field may not currently exist in `stateData`. Blake should check how journey data flows from journey-matcher into the FSM state and add toc_code propagation if needed. If this requires schema/pipeline changes, flag as a new TD item.
