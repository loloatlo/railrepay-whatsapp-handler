# TD-WHATSAPP-062-S2: Adaptive Extraction Routing

**Phase**: TD-0 (Planning / Specification)
**Backlog Item**: BL-170 (child of BL-156)
**Date**: 2026-04-02
**Owner**: Quinn (Orchestrator)
**Domain**: User Channels
**Service**: whatsapp-handler

---

## Business Context

After S1 delivered the core OCR integration (ticket photo upload, OCR service call, user confirmation), the YES path at AWAITING_OCR_REVIEW always transitions to AWAITING_JOURNEY_DATE regardless of which fields were extracted. This means a user whose ticket photo yielded all four fields (origin, destination, date, time) is still asked to re-enter their journey date -- defeating the purpose of OCR.

S2 adds the "adaptive routing" intelligence: the handler evaluates which fields OCR extracted and skips only the conversation steps already answered. Different tickets provide different field combinations, so the handler must route dynamically through 6 distinct scenarios.

**Source**: Notion > Backlog > BL-156 (TD-WHATSAPP-062) > Acceptance Criteria > Adaptive Extraction Routing (AC-4 through AC-9)

---

## Functional Requirements

### FR-1: Full Extraction Auto-Route-Match (AC-4)

When OCR returns all four critical fields (`origin` CRS + `destination` CRS + `travelDate` + `departureTime`), the handler skips all manual steps, auto-calls journey-matcher `GET /routes` with the extracted parameters, and transitions to `AWAITING_JOURNEY_CONFIRM` with the matched route in stateData.

**Current flow (S1)**:
```
AWAITING_OCR_REVIEW + "YES" -> AWAITING_JOURNEY_DATE (always)
```

**New flow (S2 - AC-4)**:
```
AWAITING_OCR_REVIEW + "YES" + all 4 fields -> call /routes -> AWAITING_JOURNEY_CONFIRM
```

**Route matching behavior**:
- Uses same pattern as `journey-time.handler.ts`: `GET {JOURNEY_MATCHER_URL}/routes?from={origin}&to={destination}&date={travelDate}&time={departureTime}`
- On success: present matched route (direct or interchange) and ask for confirmation
- On no routes found: fall back to AWAITING_JOURNEY_TIME to let user try a different time
- On error (timeout, 5xx): fall back to AWAITING_JOURNEY_TIME with stateData preserved

### FR-2: Stations + Date, No Time (AC-5)

When OCR returns `origin` + `destination` + `travelDate` but NOT `departureTime`, the handler pre-fills all three fields in stateData and skips directly to `AWAITING_JOURNEY_TIME`.

**New flow**:
```
AWAITING_OCR_REVIEW + "YES" + stations + date, no time -> AWAITING_JOURNEY_TIME
```

**Response message**: Ask only for departure time. Include the pre-filled journey context so the user knows what was extracted.

### FR-3: Stations Only, No Date (AC-6)

When OCR returns `origin` + `destination` but NOT `travelDate` (common for open returns and undated tickets), the handler pre-fills stations in stateData and skips to `AWAITING_JOURNEY_DATE`.

**New flow**:
```
AWAITING_OCR_REVIEW + "YES" + stations only, no date -> AWAITING_JOURNEY_DATE
```

**Key distinction from S1**: S1's YES always went to AWAITING_JOURNEY_DATE but without context about what was pre-filled. S2's AC-6 route explicitly communicates that stations are already captured and only the date is needed.

### FR-4: Date Only, No Stations (AC-7)

When OCR returns `travelDate` but no resolvable CRS codes (neither `origin` nor `destination`), the handler pre-fills the date in stateData and skips to `AWAITING_JOURNEY_STATIONS`.

**New flow**:
```
AWAITING_OCR_REVIEW + "YES" + date only, no stations -> AWAITING_JOURNEY_STATIONS
```

**Note**: `AWAITING_JOURNEY_STATIONS` expects the user to provide "X to Y" format. The date is already stored in stateData so the journey-stations handler will carry it forward.

### FR-5: Station Names Without CRS Codes (AC-8)

When OCR returns station names (`originName`/`destinationName`) but the CRS codes were in `missing_fields`, the handler attempts its own CRS lookup using `searchStations()` from `station.service.ts` (same function the manual flow uses).

**Resolution outcomes**:
- Both stations resolved: treat as stations-available scenario (AC-5 if date present, AC-6 if not)
- One station resolved: pre-fill the resolved station, route to appropriate next step
- Neither resolved: fall back to `AWAITING_JOURNEY_STATIONS` with date pre-filled if available

**Important**: This lookup happens synchronously during the YES handler execution. The `searchStations()` function queries `timetable_loader.stations` directly (per existing TD-WHATSAPP-045 tech debt).

### FR-6: No Usable Fields (AC-9)

When OCR returns no recognizable stations, dates, or times (all key fields null/missing), the handler falls back to `AWAITING_JOURNEY_DATE` with a friendly message.

**Response message**: "I couldn't read your ticket clearly. Let's enter your journey details manually."

**Distinction from S1's YES path**: S1's YES kept all OCR metadata (scan_id, confidence, etc.) even when proceeding. AC-9 should still preserve OCR metadata (scan_id, image_gcs_path) for traceability even though no journey fields were usable.

---

## Decision Tree (Implementation Logic)

```
User says YES at AWAITING_OCR_REVIEW
  |
  +-- Has origin CRS? (stateData.origin)
  |   +-- Has destination CRS? (stateData.destination)
  |   |   +-- Has travelDate? (stateData.travelDate)
  |   |   |   +-- Has departureTime? (stateData.departureTime)
  |   |   |   |   -> AC-4: Full extraction -> call /routes -> AWAITING_JOURNEY_CONFIRM
  |   |   |   |
  |   |   |   +-- No departureTime
  |   |   |       -> AC-5: Stations + date -> AWAITING_JOURNEY_TIME
  |   |   |
  |   |   +-- No travelDate
  |   |       -> AC-6: Stations only -> AWAITING_JOURNEY_DATE
  |   |
  |   +-- No destination CRS (but has origin)
  |       -> Partial stations: treat as missing stations scenario
  |
  +-- No origin CRS
      +-- Has originName or destinationName? (station names without CRS)
      |   -> AC-8: Attempt CRS lookup via searchStations()
      |       +-- Lookup succeeds (both resolved)
      |       |   -> Re-evaluate as AC-4/5/6 with resolved CRS codes
      |       +-- Lookup partially succeeds
      |       |   -> Pre-fill what resolved, route to next missing step
      |       +-- Lookup fails
      |           -> Has travelDate?
      |               +-- Yes -> AC-7 variant: date pre-filled -> AWAITING_JOURNEY_STATIONS
      |               +-- No  -> AC-9: No usable fields -> AWAITING_JOURNEY_DATE
      |
      +-- No station names either
          +-- Has travelDate?
          |   -> AC-7: Date only -> AWAITING_JOURNEY_STATIONS
          |
          +-- No travelDate
              -> AC-9: No usable fields -> AWAITING_JOURNEY_DATE
```

---

## Non-Functional Requirements

### Performance
- AC-4 route matching adds one HTTP call to journey-matcher (same as journey-time.handler). 30s timeout is acceptable (handles cold starts).
- AC-8 CRS lookup adds one DB query per station name. Expected latency <100ms per query.

### Observability (ADR-002, ADR-008)
- Log the routing decision made (which AC path taken) at INFO level with correlation ID
- Log CRS fallback attempts and results at INFO level
- Log route-matching call and response at INFO level (consistent with journey-time.handler pattern)

### Error Handling
- Route-matcher errors during AC-4 should NOT crash the handler. Fall back to AWAITING_JOURNEY_TIME.
- Station lookup errors during AC-8 should NOT crash the handler. Fall back as if lookup failed.
- All error paths must preserve OCR metadata (scan_id, image_gcs_path) in stateData.

---

## ADR Applicability

| ADR | Applies | Notes |
|-----|---------|-------|
| ADR-001 Schema-per-service | No | No schema changes |
| ADR-002 Winston Logger | Yes | Structured logging with correlation IDs |
| ADR-004 Vitest | Yes | All tests use Vitest |
| ADR-008 Prometheus Metrics | Yes | Via existing metrics setup |
| ADR-014 TDD | Yes | Tests written FIRST by Jessie |

---

## Files Modified

### Primary
- `services/whatsapp-handler/src/handlers/ocr-review.handler.ts` -- Major rewrite of YES branch to add adaptive routing logic

### Supporting (read-only dependencies)
- `services/whatsapp-handler/src/services/station.service.ts` -- Used by AC-8 for CRS lookup (no modifications expected)
- `services/whatsapp-handler/src/services/fsm.service.ts` -- FSMState enum (no new states needed; all target states already exist)
- `services/whatsapp-handler/src/handlers/index.ts` -- HandlerContext/HandlerResult types (no modifications)

### Test Files
- `services/whatsapp-handler/tests/unit/handlers/ocr-review.handler.test.ts` -- Major expansion for AC-4 through AC-9

---

## Existing Test Impact

The S1 test file `ocr-review.handler.test.ts` has tests for AC-11 (YES -> AWAITING_JOURNEY_DATE). S2 changes the YES behavior so it no longer always goes to AWAITING_JOURNEY_DATE. Jessie will need to:

1. **Replace** the AC-11 YES tests that assert `nextState === AWAITING_JOURNEY_DATE` unconditionally
2. **Add** new test suites for each AC (4-9) with appropriate stateData fixtures
3. **Preserve** AC-10 (summary display), AC-12 (NO rejection), and invalid-input tests unchanged

The AC-11 tests from S1 are effectively superseded by S2's adaptive routing. The new behavior IS the AC-4 through AC-9 routing, which replaces the simple "YES -> AWAITING_JOURNEY_DATE" path.

**Test Lock Rule consideration**: Since Jessie wrote the S1 tests AND owns the S2 tests, Jessie is replacing her own tests. This is not a Test Lock violation -- it's Jessie updating her own test specification for new behavior.

---

## Technical Debt Notes

- **TD-WHATSAPP-066** (BL-169): "Increase ocr-review.handler.ts partial-extraction branch test coverage" will be **SUPERSEDED** by S2 work. S2 rewrites the YES branch entirely and adds comprehensive tests for all extraction scenarios. Mark TD-WHATSAPP-066 as "Superseded by BL-170" after S2 completion.
- **TD-WHATSAPP-045**: station.service.ts still queries timetable_loader.stations directly (cross-schema). This pre-existing debt is not addressed by S2 but is used by AC-8.
- **TD-OCR-003** (parser granularity): Task context notes the parser ALREADY returns granular types. Not a blocker for S2 (S2 only handles routing, not ticket type classification).

---

## Definition of Done

### TDD
- [ ] Jessie writes failing tests for AC-4 through AC-9 BEFORE Blake implements
- [ ] Blake makes all tests GREEN
- [ ] All S1 tests (AC-10, AC-12, invalid input) continue passing

### Code Quality
- [ ] No `any` types in new code (use proper interfaces)
- [ ] ESLint/Prettier clean
- [ ] Consistent with existing handler patterns

### Observability
- [ ] Winston logs with correlation IDs for routing decisions
- [ ] Error cases logged at appropriate severity

### Coverage
- [ ] >= 80% lines/functions/statements for ocr-review.handler.ts
- [ ] >= 75% branches for ocr-review.handler.ts

### Sign-Offs
- [ ] Jessie approved (QA sign-off from Phase TD-3)
- [ ] Moykle approved (deployment from Phase TD-4)
- [ ] Technical debt recorded (BLOCKING)
- [ ] Quinn final approval (Phase TD-5)

---

## Handoff: Phase TD-1 (Jessie)

### Context
Quinn has completed Phase TD-0. The specification covers AC-4 through AC-9 of the parent BL-156. The primary change is to the YES branch of `ocr-review.handler.ts`.

### Deliverables Required
- [ ] Failing test suite for AC-4: Full extraction -> route match -> AWAITING_JOURNEY_CONFIRM
- [ ] Failing test suite for AC-5: Stations + date -> AWAITING_JOURNEY_TIME
- [ ] Failing test suite for AC-6: Stations only -> AWAITING_JOURNEY_DATE (with context message)
- [ ] Failing test suite for AC-7: Date only -> AWAITING_JOURNEY_STATIONS
- [ ] Failing test suite for AC-8: Station name CRS fallback (success, partial, failure)
- [ ] Failing test suite for AC-9: No usable fields -> AWAITING_JOURNEY_DATE with fallback message
- [ ] AC-4 route-matcher error handling tests (timeout, no routes, 5xx)
- [ ] S1 regression: AC-10, AC-12, invalid input tests still pass

### Quality Gates
- [ ] All new tests are runnable (import correctly, fail for right reason)
- [ ] Tests use Vitest (not Jest) per ADR-004
- [ ] Mocking pattern consistent with S1 tests (vi.mock for winston-logger)
- [ ] No placeholder assertions (every assertion is meaningful)

### Blocking Rules
- Tests MUST fail (RED phase) before handing to Blake
- Blake MUST NOT modify Jessie's tests (Test Lock Rule)

### Key stateData Fixtures

**Full extraction (AC-4)**:
```typescript
{ origin: 'PAD', destination: 'BRI', originName: 'London Paddington',
  destinationName: 'Bristol Temple Meads', travelDate: '2026-03-15',
  departureTime: '14:30', scan_id: 'scan-001', ocr_confidence: 0.91,
  image_gcs_path: 'gs://...', claim_ready: true }
```

**Stations + date (AC-5)**:
```typescript
{ origin: 'PAD', destination: 'BRI', originName: 'London Paddington',
  destinationName: 'Bristol Temple Meads', travelDate: '2026-03-15',
  scan_id: 'scan-002', ocr_confidence: 0.85, image_gcs_path: 'gs://...' }
```

**Stations only (AC-6)**:
```typescript
{ origin: 'MAN', destination: 'LDS', originName: 'Manchester Piccadilly',
  destinationName: 'Leeds', scan_id: 'scan-003', ocr_confidence: 0.70,
  image_gcs_path: 'gs://...' }
```

**Date only (AC-7)**:
```typescript
{ travelDate: '2026-04-01', scan_id: 'scan-004', ocr_confidence: 0.40,
  image_gcs_path: 'gs://...' }
```

**Station names without CRS (AC-8)**:
```typescript
{ originName: 'London Paddington', destinationName: 'Bristol Temple Meads',
  travelDate: '2026-03-15', scan_id: 'scan-005', ocr_confidence: 0.60,
  image_gcs_path: 'gs://...' }
// NOTE: origin and destination (CRS codes) are ABSENT
```

**No usable fields (AC-9)**:
```typescript
{ scan_id: 'scan-006', ocr_confidence: 0.15, image_gcs_path: 'gs://...',
  claim_ready: false }
```

### Mocking Requirements

- `@railrepay/winston-logger`: mock as in S1 tests
- `axios`: mock for AC-4 journey-matcher `/routes` call (success, no-routes, error scenarios)
- `station.service.ts` `searchStations()`: mock for AC-8 CRS fallback (resolve, partial, fail)
- `JOURNEY_MATCHER_URL` env var: set in test setup for AC-4

### References
- Parent spec: Notion > BL-156 (TD-WHATSAPP-062) page ID `309815ba72ee817d9f38c0e695854e9b`
- S1 completion: BL-167 page ID `332815ba72ee812a90a4f3d41ad8759b`
- S2 BL item: BL-170 page ID `336815ba-72ee-81dc-9926-e6c05401f7d2`
- Current ocr-review.handler.ts: `services/whatsapp-handler/src/handlers/ocr-review.handler.ts`
- Route matching pattern: `services/whatsapp-handler/src/handlers/journey-time.handler.ts`
- Station lookup: `services/whatsapp-handler/src/services/station.service.ts`
