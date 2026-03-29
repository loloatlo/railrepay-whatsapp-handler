# TD-WHATSAPP-062-S1: Core FSM + OCR Call + User Confirmation

**Phase**: TD-0 (Planning / Specification)
**Backlog Item**: BL-167 (child of BL-156)
**Date**: 2026-03-29
**Owner**: Quinn (Orchestrator)
**Domain**: User Channels
**Service**: whatsapp-handler

---

## Business Context

RailRepay's WhatsApp-based journey registration currently requires users to manually enter every journey field (date, stations, time). Most users have their physical or digital train ticket available. By allowing them to photograph the ticket and extracting journey details via OCR, we dramatically reduce friction and improve completion rates.

This sub-story implements the **minimum viable OCR integration**: the branching point, the OCR HTTP call, a confirmation step, and graceful error handling. It does NOT implement adaptive routing (skipping fields based on what OCR extracted) or ticket type intelligence -- those are later sub-stories.

**Source**: Notion > Backlog > BL-156 (TD-WHATSAPP-062) > Epic Detection Note > Sub-Story 1

---

## Functional Requirements

### FR-1: New Branching State After Authentication (AC-1)

When a verified user types DELAY or CLAIM at the AUTHENTICATED state, the handler transitions to a new `AWAITING_TICKET_OR_MANUAL` state instead of directly going to `AWAITING_JOURNEY_DATE`.

**Current flow**:
```
AUTHENTICATED + "DELAY" -> AWAITING_JOURNEY_DATE
```

**New flow**:
```
AUTHENTICATED + "DELAY" -> AWAITING_TICKET_OR_MANUAL
```

**Prompt text**: "Send a photo of your ticket to get started quickly, or type MANUAL to enter your journey details."

### FR-2: MANUAL Keyword Bypass (AC-2)

At `AWAITING_TICKET_OR_MANUAL`, if user types MANUAL (case-insensitive), transition to `AWAITING_JOURNEY_DATE` with the same prompt as the current DELAY flow. This preserves the existing manual flow exactly.

### FR-3: Media Triggers OCR Call (AC-3)

At `AWAITING_TICKET_OR_MANUAL`, if the incoming message has a `mediaUrl` (Twilio media attachment), the handler calls the OCR service synchronously:

```
POST http://{OCR_SERVICE_URL}/ocr/scan
Content-Type: application/json

{
  "image_url": "{twilio_media_url}",
  "user_id": "{user_phone_or_db_id}",
  "content_type": "{detected_content_type}",
  "correlation_id": "{correlation_id}"
}
```

**Content type detection**: Twilio provides `MediaContentType0` in the webhook payload. Map to: `image/jpeg`, `image/png`, or `application/pdf`. If unsupported type, send error message and stay in `AWAITING_TICKET_OR_MANUAL`.

### FR-4: OCR Review State (AC-10)

On successful OCR response (status 200, `status: 'completed'`), transition to `AWAITING_OCR_REVIEW` and present a readable summary of whatever fields were extracted. Example:

```
I found the following details from your ticket:

From: London Paddington (PAD)
To: Bristol Temple Meads (BRI)
Date: 2026-03-15
Time: 14:30
Ticket: Advance Single, Standard Class

Is this correct? (YES / NO)
```

Only show fields that were actually extracted (non-null in `extracted_fields`). If very few fields extracted, still show what was found.

Store in stateData: `scan_id`, `image_gcs_path`, `ocr_confidence`, `claim_ready`, and all non-null extracted fields under their standard field names.

### FR-5: User Confirms OCR (AC-11)

YES at `AWAITING_OCR_REVIEW`: Keep all OCR-extracted fields in stateData and transition to `AWAITING_JOURNEY_DATE`. The existing journey-date handler will see pre-filled fields in stateData.

**Note for Sub-Story 2**: This transition target will be changed to implement adaptive routing (skipping already-answered steps). For now, always going to `AWAITING_JOURNEY_DATE` is correct.

### FR-6: User Rejects OCR (AC-12)

NO at `AWAITING_OCR_REVIEW`: Discard all OCR data from stateData, transition to `AWAITING_JOURNEY_DATE` with clean stateData (same as if user had typed MANUAL).

### FR-7: OCR Service Error Handling (AC-22)

If the OCR service returns 503, times out (>10s), or is unreachable (ECONNREFUSED, DNS failure), gracefully fall back:

- Message: "I couldn't process your ticket photo right now. Let's enter your journey details manually."
- Transition to `AWAITING_JOURNEY_DATE` with clean stateData
- Log warning with correlation_id and error details

### FR-8: No Regression (AC-24)

All existing FSM transitions, handlers, and conversation flows MUST remain 100% functional. The only change to existing code is the DELAY/CLAIM transition target in `authenticated.handler.ts`.

### FR-9: Environment Configuration (AC-25)

New env var `OCR_SERVICE_URL`:
- Default: `http://railrepay-ocr.railway.internal:3010`
- Used by `ocr-client.service.ts` to construct the OCR endpoint URL
- Added to whatsapp-handler's config module

---

## Non-Functional Requirements

- **Performance**: OCR call timeout = 10 seconds. If exceeded, fall back gracefully (FR-7).
- **Observability**: Log OCR call duration, success/failure, and extracted field count. Use `@railrepay/winston-logger` with correlation IDs.
- **Security**: Twilio media URLs are ephemeral (expire after ~2 hours). The OCR service downloads and stores in GCS. No PII logging of ticket contents.
- **Resilience**: OCR failure must never block the conversation. Always fall back to manual.

---

## ADR Applicability

| ADR | Applies | Notes |
|-----|---------|-------|
| ADR-001 Schema-per-service | No | No schema changes in this sub-story |
| ADR-002 Winston Logger | Yes | All new handlers use correlation ID logging |
| ADR-003 Testcontainers | No | No DB changes; unit tests with mocks sufficient |
| ADR-004 Vitest | Yes | All tests use Vitest |
| ADR-005 Railway Direct Deploy | Yes | Deployment via Railway |
| ADR-008 Prometheus Metrics | Yes | OCR call duration histogram, success/failure counter |
| ADR-010 Smoke Tests | Yes | Post-deployment health check |
| ADR-014 TDD | Yes | Tests before implementation |
| ADR-015 whatsapp-handler Schema Simplification | N/A | No schema changes |

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/handlers/ticket-or-manual.handler.ts` | Handles AWAITING_TICKET_OR_MANUAL state: MANUAL keyword, media dispatch to OCR, text-without-media error |
| `src/handlers/ocr-review.handler.ts` | Handles AWAITING_OCR_REVIEW state: YES confirms, NO discards |
| `src/services/ocr-client.service.ts` | HTTP client for OCR service. POST /ocr/scan with timeout, error handling |

## Files to Modify

| File | Change |
|------|--------|
| `src/services/fsm.service.ts` | Add `AWAITING_TICKET_OR_MANUAL` and `AWAITING_OCR_REVIEW` to FSMState enum |
| `src/handlers/authenticated.handler.ts` | Change DELAY/CLAIM transition from `AWAITING_JOURNEY_DATE` to `AWAITING_TICKET_OR_MANUAL` |
| `src/handlers/index.ts` | Import and register new handlers |
| `src/types/index.ts` | Add new states to any type definitions if duplicated there |
| Config module | Add `OCR_SERVICE_URL` env var |

## Tests to Create (Jessie's Responsibility)

| Test File | Covers |
|-----------|--------|
| `tests/unit/handlers/ticket-or-manual.handler.test.ts` | AC-1, AC-2, AC-3, AC-22 |
| `tests/unit/handlers/ocr-review.handler.test.ts` | AC-10, AC-11, AC-12 |
| `tests/unit/services/ocr-client.service.test.ts` | OCR HTTP call success, 503, timeout, network error |
| `tests/unit/handlers/authenticated.handler.test.ts` (update) | AC-1 regression: DELAY/CLAIM now goes to AWAITING_TICKET_OR_MANUAL |
| `tests/unit/services/fsm.service.test.ts` (update) | New states exist in enum |

---

## OCR Service Response Contract

**Success (200)**:
```json
{
  "scan_id": "uuid",
  "status": "completed",
  "confidence": 0.85,
  "extracted_fields": {
    "origin_station": "London Paddington",
    "destination_station": "Bristol Temple Meads",
    "origin_crs": "PAD",
    "destination_crs": "BRI",
    "travel_date": "2026-03-15",
    "departure_time": "14:30",
    "ticket_type": "advance single",
    "ticket_class": "standard",
    "fare_pence": 3500,
    "via_station": null,
    "via_crs": null,
    "operator_name": "GWR"
  },
  "missing_fields": [],
  "claim_ready": true,
  "ocr_status": "completed",
  "gcs_upload_status": "uploaded",
  "image_gcs_path": "gs://railrepay-tickets-prod/user123/scan-uuid.jpg"
}
```

**OCR Unavailable (503)**:
```json
{
  "error": "GCV OCR unavailable: ...",
  "missing_fields": ["origin_station", "destination_station", "origin_crs", "destination_crs", "travel_date", "fare_pence", "ticket_type", "ticket_class", "departure_time", "via_station", "via_crs", "operator_name"],
  "scan_id": "uuid"
}
```

---

## FSM State Transition Diagram (This Sub-Story)

```
AUTHENTICATED
  |
  +-- "DELAY" / "CLAIM" --> AWAITING_TICKET_OR_MANUAL
                              |
                              +-- "MANUAL" --> AWAITING_JOURNEY_DATE (existing flow)
                              |
                              +-- Media (photo/PDF) --> Call OCR service
                              |     |
                              |     +-- OCR success --> AWAITING_OCR_REVIEW
                              |     |                    |
                              |     |                    +-- "YES" --> AWAITING_JOURNEY_DATE (stateData pre-filled)
                              |     |                    |
                              |     |                    +-- "NO" --> AWAITING_JOURNEY_DATE (clean stateData)
                              |     |
                              |     +-- OCR error (503/timeout) --> AWAITING_JOURNEY_DATE (fallback)
                              |
                              +-- Text (not MANUAL) --> Error msg, stay in AWAITING_TICKET_OR_MANUAL
```

---

## Hoops Assessment (TD-0.5)

**Hoops is NOT needed for this sub-story.** No database schema changes are required. The whatsapp-handler stores conversation state in Redis (not Postgres) and the OCR service already has its own schema. All data in this sub-story lives in Redis stateData.

---

## Workflow Sequence

```
Quinn (TD-0: This specification) -- COMPLETE
  |
  v
Jessie (TD-1: Write failing tests for all 9 ACs)
  |
  v
Blake (TD-2: Implement handlers and services to make tests green)
  |
  v
Jessie (TD-3: QA sign-off -- coverage >= 80% lines/functions/statements, >= 75% branches)
  |
  v
Moykle (TD-4: Deploy to Railway)
  |
  v
Quinn (TD-5: Verification and close-out)
```

---

## Quality Gates

### TD-1 -> TD-2 Gate (Jessie -> Blake)
- [ ] All test files created and listed above
- [ ] All tests fail (RED phase)
- [ ] Tests cover all 9 ACs with at least one test per AC
- [ ] Tests use Vitest (not Jest)
- [ ] Tests mock OCR HTTP calls (not real network calls)
- [ ] Tests use existing HandlerContext/HandlerResult interfaces

### TD-2 -> TD-3 Gate (Blake -> Jessie)
- [ ] All tests pass (GREEN phase)
- [ ] No modification to Jessie's tests (Test Lock Rule)
- [ ] New handlers follow existing handler patterns
- [ ] OCR client uses fetch/node-fetch with timeout
- [ ] Config module exports OCR_SERVICE_URL
- [ ] No `any` types in new code
- [ ] ESLint/Prettier clean

### TD-3 -> TD-4 Gate (Jessie -> Moykle)
- [ ] Coverage >= 80% lines/functions/statements
- [ ] Coverage >= 75% branches
- [ ] All ACs have passing tests
- [ ] No regressions in existing test suite
- [ ] QA sign-off issued

### TD-4 -> TD-5 Gate (Moykle -> Quinn)
- [ ] Deployed to Railway
- [ ] Health check passing
- [ ] OCR_SERVICE_URL env var configured
- [ ] No deployment errors

---

## Definition of Done

- [ ] All 9 ACs verified with passing tests
- [ ] Coverage thresholds met
- [ ] No regression in existing whatsapp-handler tests
- [ ] Deployed to Railway with OCR_SERVICE_URL configured
- [ ] BL-167 status updated to Complete
- [ ] Technical debt recorded (if any shortcuts taken)
