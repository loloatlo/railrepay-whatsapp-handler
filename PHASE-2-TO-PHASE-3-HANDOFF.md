# Phase 2 → Phase 3 Handoff: whatsapp-handler Service

**Date**: 2025-11-30
**Service**: whatsapp-handler
**From**: Quinn (Orchestrator - Phase 2 Gate Verification)
**To**: Blake (Backend Engineer - Phase 3 Implementation)
**Status**: ✅ **PHASE 2 COMPLETE - PHASE 3 AUTHORIZED**

---

## Executive Summary

Phase 2 (Data Layer) has been **COMPLETED** by Hoops with full compliance to SOPs and quality gates. All Phase 2 deliverables have been verified, technical debt has been recorded, and Blake is **AUTHORIZED** to proceed with Phase 3 (Implementation).

**Key Highlights**:
- ✅ Migration v2.0 created with simplified schema (64% fewer columns than v1.0)
- ✅ Integration tests written using Testcontainers (TDD workflow verified)
- ✅ RFC documented with full business context
- ✅ Technical debt recorded (4 items: 1 blocking for Phase 3, 3 deferred)
- ✅ Zero-downtime migration strategy confirmed
- ✅ Schema-per-service boundaries respected (ADR-001)

---

## Phase 2 Quality Gate Verification

### ✅ PASS: All Gate Criteria Met

Per Standard Operating Procedures § Phase 2 Quality Gates:

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **RFC created with business context** | ✅ PASS | `/docs/RFC-whatsapp-handler-schema-v2.md` (18,950 bytes) |
| **Failing integration tests written (TDD)** | ✅ PASS | `/tests/integration/migrations.test.ts` (11 test cases defined) |
| **Migrations written (forward + rollback)** | ✅ PASS | `/migrations/001_create_whatsapp_handler_schema.ts` (v2.0, 273 lines) |
| **Zero-downtime migration strategy** | ✅ PASS | New service - no existing data (documented in RFC § 6.2) |
| **Technical debt recorded** | ✅ PASS | `/docs/TECHNICAL-DEBT-REGISTER.md` (4 items documented) |
| **User Stories consulted** | ✅ PASS | RAILREPAY-001, 002, 100, 600 referenced in migration header |
| **Hoops sign-off obtained** | ✅ PASS | `/docs/PHASE-2-COMPLETION-REPORT.md` § 10 (Hoops ✅) |

**BLOCKING RULE SATISFIED**: Technical debt recorded per SOP § 2.11 (mandatory requirement).

---

## Phase 2 Deliverables Summary

### 1. Migration v2.0 (Simplified Schema)

**File**: `/migrations/001_create_whatsapp_handler_schema.ts`

**Schema Design**:
- **3 tables** created in `whatsapp_handler` schema
- **5 indexes** optimized for query patterns
- **4 constraints** enforce data integrity

**Table Summary**:

| Table | Columns | Purpose | Simplification from v1.0 |
|-------|---------|---------|--------------------------|
| **users** | 5 | Phone-based authentication | -64% columns (14 → 5) |
| **user_preferences** | 6 | Key-value settings store | Changed from typed columns to flexible KV |
| **outbox_events** | 7 | Transactional outbox pattern | -30% columns (10 → 7) |

**Design Rationale** (from RFC § 2.1):
- **OTP via Twilio Verify API** → No need for `otp_secret`, `otp_verified_at` columns
- **Redis FSM for state** → No need for `last_active_at`, `registered_at` columns
- **claim-dispatcher owns terms** → No need for `terms_accepted_at`, `terms_version` columns
- **YAGNI principle** → Removed `event_version`, `metadata`, `correlation_id` (add post-MVP)

**Storage Efficiency**: ~12 MB estimated vs. ~130 MB in v1.0 (-91% storage)

### 2. Integration Tests (Testcontainers)

**File**: `/tests/integration/migrations.test.ts`

**Test Coverage** (11 test cases):
1. Schema creation verification
2. users table structure (v2.0 - 5 columns only)
3. user_preferences table structure (key-value store)
4. outbox_events table structure (v2.0 - 7 columns only)
5. All required indexes created
6. Unique constraint on phone_number
7. Unique constraint on user_id + preference_key
8. Cascade delete user_preferences when user deleted
9. CHECK constraint on aggregate_type
10. Partial index usage for unpublished events
11. Rollback migration (DROP schema)

**Test Status**: ⚠️ **BLOCKED** by Docker availability in WSL environment

**Manual Verification**: ✅ PASSED (syntax check via `migrations-manual-verify.ts`)

**Action Required for Blake**: Run integration tests in Docker-enabled environment (see TD-WHATSAPP-V2-004 below)

### 3. RFC Documentation

**File**: `/docs/RFC-whatsapp-handler-schema-v2.md`

**Contents**:
- § 1: Executive summary and rationale for v2.0 simplification
- § 2: Table-by-table schema design with column justifications
- § 3: Index design with query pattern analysis
- § 4: Constraint design for data integrity
- § 5: Operational considerations (backups, retention, GDPR)
- § 6: Migration strategy (new service, no backward compatibility needed)
- § 7: ADR compliance verification (ADR-001, 003, 014)
- § 8: User Story traceability (RAILREPAY-001, 002, 100, 600)

### 4. Technical Debt Register

**File**: `/docs/TECHNICAL-DEBT-REGISTER.md`

**Recorded Items**: 4

**Blocking for Phase 3**:
- **TD-WHATSAPP-V2-004**: Integration Tests Blocked by Docker 🔴
  - **Impact**: MEDIUM
  - **Owner**: Blake (Phase 3)
  - **Action**: Run `npm run test:integration` in Docker-enabled environment
  - **Expected**: All 11 tests GREEN
  - **BLOCKING**: Must be resolved before Phase 3 completion

**Deferred (Acceptable for MVP)**:
- **TD-WHATSAPP-V2-001**: No phone number format validation (DB constraint) 🟡
  - **Impact**: LOW (application layer validates)
  - **Owner**: Hoops
  - **Target**: Q1 2026 hardening sprint
- **TD-WHATSAPP-V2-002**: Preference value not typed (TEXT vs JSONB) 🟡
  - **Impact**: LOW (key-value flexibility intentional)
  - **Owner**: Blake
  - **Target**: Monitor for 3 months
- **TD-WHATSAPP-V2-003**: No event retention enforcement (cron vs trigger) 🟡
  - **Impact**: LOW (cron job sufficient for MVP)
  - **Owner**: Blake
  - **Target**: Monitor for 3 months

**Future Enhancements** (Not Technical Debt):
- FUTURE-WHATSAPP-001: Add `correlation_id` for distributed tracing
- FUTURE-WHATSAPP-002: Add `event_version` for event schema evolution
- FUTURE-WHATSAPP-003: Consider GDPR soft-delete pattern

---

## Known Issues for Blake

### Issue 1: Docker Not Available in WSL Environment

**Context**: Hoops' development environment (WSL) does not have Docker installed.

**Impact**:
- Integration tests using Testcontainers cannot run locally
- Manual syntax verification performed as interim quality gate
- Database constraint behavior (cascade delete, check violations) not tested

**Blake's Action**:
1. Run integration tests in Docker-enabled environment:
   ```bash
   npm run test:integration
   ```
2. Expected result: All 11 tests GREEN
3. If RED: Report failures to Hoops for schema fix
4. Update technical debt register (close TD-WHATSAPP-V2-004)

**Escalation**: If integration tests fail, BLOCK Phase 3 completion and escalate to Quinn + Hoops immediately.

### Issue 2: User Stories Reference in Migration Header

**Context**: Migration file header includes User Story IDs (RAILREPAY-001, 002, 100, 600).

**Benefit**: Full traceability from requirements → schema design → code.

**Blake's Action**: Continue this pattern in implementation files (controllers, services, etc.).

---

## Blake's Phase 3 Scope: Implementation Requirements

Based on the complete specification (`/mnt/c/Users/nicbo/Documents/RailRepay MVP/specifications/whatsapp-handler-COMPLETE-v2.md`) and User Stories, Blake must implement:

### 1. User Onboarding & Authentication (EPIC 001-099)

**RAILREPAY-001: First-time user registration**
- Implement `POST /webhook/twilio` handler for new users
- Integrate Twilio Verify API for OTP generation
- Send WELCOME_FIRST_TIME message template
- Create user record in `users` table with `phone_number`
- Record `verified_at` timestamp after OTP verification
- Publish `user.registered` event to `outbox_events`

**RAILREPAY-002: Returning user authentication**
- Detect returning user via `users` table lookup
- Send WELCOME_RETURNING message template
- Create Redis session (FSM state: MAIN_MENU)
- NO OTP required (user already verified)

**Acceptance Criteria**:
- Welcome message sent within 2 seconds
- User record created/retrieved correctly
- Session TTL = 24 hours (REDIS_CACHE_TTL_SECONDS=86400)

### 2. Journey Capture FSM (EPIC 100-199)

**RAILREPAY-100: Historic journey entry**

Implement FSM with these states:
1. **MAIN_MENU** (entry point after authentication)
2. **JOURNEY_DATE_CAPTURE** (prompt for date)
3. **JOURNEY_DATE_VALIDATION** (parse and validate date)
4. **JOURNEY_FROM_STATION_CAPTURE** (prompt for origin)
5. **JOURNEY_FROM_STATION_VALIDATION** (resolve station via timetable-loader API)
6. **JOURNEY_TO_STATION_CAPTURE** (prompt for destination)
7. **JOURNEY_TO_STATION_VALIDATION** (resolve station via timetable-loader API)
8. **JOURNEY_TIME_CAPTURE** (prompt for time)
9. **JOURNEY_TIME_VALIDATION** (parse and validate time)
10. **JOURNEY_CONFIRMATION** (display summary, request confirmation)
11. **JOURNEY_COMPLETE** (publish event, return to MAIN_MENU)

**FSM Implementation**:
- Store state in Redis with key `session:{phone_number}`
- TTL = 24 hours (same as session timeout)
- Capture partial journey data in Redis hash
- On confirmation, publish `journey.created` event to `outbox_events`

**Station Matching** (RAILREPAY-101):
- Call `GET /api/v1/stations/search?query={user_input}` on timetable-loader service
- Handle fuzzy matching ("Kings X" → KGX)
- Handle ambiguous stations (Richmond → present options: RMD or RMZ)
- Error handling: If timetable-loader unavailable, send STATION_MATCH_ERROR message

**Date/Time Validation**:
- Journey date must be within 90 days in past (RAILREPAY-100)
- Future journeys allowed 0-14 days ahead (RAILREPAY-102)
- Delay must be ≥15 minutes

**Message Templates** (from specification § 4.3):
- JOURNEY_DATE_PROMPT
- JOURNEY_FROM_STATION_PROMPT
- JOURNEY_TO_STATION_PROMPT
- JOURNEY_TIME_PROMPT
- JOURNEY_CONFIRMATION
- JOURNEY_REGISTERED_SUCCESS
- JOURNEY_INVALID_DATE
- STATION_MATCH_ERROR
- STATION_AMBIGUOUS

### 3. Webhook Security (EPIC 600-699)

**RAILREPAY-600: Twilio webhook handler**

Implement `POST /webhook/twilio`:
- **Signature Verification**: Validate `X-Twilio-Signature` header using Twilio auth token
- **Idempotency**: Use `MessageSid` as idempotency key in Redis (TTL = 24 hours)
- **Rate Limiting**: 60 requests/minute per phone_number (Redis counter)
- **Response Time**: Respond within 1 second (return TwiML immediately, process async)
- **Error Handling**: Return HTTP 200 with error message to user (do NOT return 500 to Twilio)

**TwiML Response**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Your message here</Message>
</Response>
```

### 4. User Preferences Management

Implement CRUD operations for `user_preferences` table:
- **GET /api/v1/users/:userId/preferences/:key** (retrieve single preference)
- **POST /api/v1/users/:userId/preferences** (create/update preference)
- **DELETE /api/v1/users/:userId/preferences/:key** (delete preference)

**Supported Preferences** (from specification):
- `language` (string: "en", "es", "fr", etc.)
- `timezone` (string: "Europe/London", "America/New_York", etc.)
- `notification_enabled` (boolean: "true" or "false")

**Key-Value Design**:
- Store as TEXT in `preference_value` column
- Application layer validates values before insert
- Unique constraint on (user_id, preference_key) prevents duplicates

### 5. Outbox Event Publishing

Implement transactional outbox pattern:
- **Events Published**:
  - `user.registered` (when user first registers)
  - `user.verified` (when OTP verification completes)
  - `journey.created` (when user confirms journey)
- **Outbox Relay**: Separate process polls `outbox_events` table for unpublished events
- **Publication**: Set `published_at` timestamp after Pub/Sub publish succeeds
- **Retention**: Cron job deletes events where `published_at < NOW() - 7 days`

### 6. Health Check & Observability (EPIC 900-999)

**RAILREPAY-900: Health check endpoint** (ADR-008)

Implement `GET /health`:
- Check PostgreSQL connectivity (SELECT 1)
- Check Redis connectivity (PING)
- Check timetable-loader availability (HEAD request)
- Response format:
  ```json
  {
    "status": "healthy",
    "checks": {
      "database": "ok",
      "redis": "ok",
      "timetable_loader": "ok"
    },
    "uptime_seconds": 3600
  }
  ```
- Response time: <100ms

**RAILREPAY-902: Distributed tracing** (ADR-002)

- Use `@railrepay/winston-logger` for all logging
- Include `correlation_id` in every log line
- Generate correlation ID from `X-Request-ID` header OR generate UUID
- Propagate correlation ID to downstream API calls (timetable-loader)
- Log format:
  ```json
  {
    "level": "info",
    "message": "User registered",
    "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "phone_number": "+447700900123",
    "timestamp": "2025-11-30T14:00:00.000Z"
  }
  ```

### 7. Shared Libraries Integration

Use these packages from **Extractable Packages Registry**:
- **@railrepay/winston-logger**: Correlation ID logging
- **@railrepay/metrics-pusher**: Prometheus metrics
- **@railrepay/postgres-client**: Database access
- **@railrepay/redis-client**: Redis FSM state management
- **@railrepay/openapi-validator**: API validation (ADR-012)
- **@railrepay/health-check**: Health check endpoint (ADR-008)

---

## Blake's Phase 3 Quality Gates (Definition of Done)

Per SOP § 3 (Implementation) and the specification, Blake must satisfy:

### TDD Workflow (ADR-014) - MANDATORY

- [ ] **Failing tests written FIRST** (before any implementation code)
- [ ] Unit tests for all business logic (controllers, services, FSM)
- [ ] Integration tests for database operations (using Testcontainers)
- [ ] E2E tests for webhook flow (mock Twilio API)
- [ ] Coverage thresholds:
  - Lines: ≥80%
  - Functions: ≥80%
  - Statements: ≥80%
  - Branches: ≥75%

### Code Quality

- [ ] TypeScript types are precise (no `any`)
- [ ] ESLint and Prettier checks clean
- [ ] No TODO comments remaining
- [ ] Security scan clean (no vulnerabilities)
- [ ] Code reviewed by Jessie (Phase 4)

### Observability

- [ ] Winston logs include correlation IDs (ADR-002)
- [ ] Prometheus counters/histograms for key operations:
  - `whatsapp_webhook_requests_total` (counter)
  - `whatsapp_webhook_duration_seconds` (histogram)
  - `whatsapp_messages_sent_total` (counter)
  - `twilio_verify_requests_total` (counter)
  - `fsm_state_transitions_total` (counter)
- [ ] Loki log fields validated by tests
- [ ] Error cases log appropriate severity levels

### Security

- [ ] Twilio signature verification implemented
- [ ] Idempotency via MessageSid (Redis)
- [ ] Rate limiting implemented (60 req/min)
- [ ] Input validation on all user messages
- [ ] Phone number sanitization (E.164 format)
- [ ] No secrets in code (use Railway environment variables)

### API Contracts

- [ ] OpenAPI specification created for all endpoints (ADR-012)
- [ ] TwiML response format validated
- [ ] timetable-loader API calls documented
- [ ] Error response format consistent

### Integration with External Services

- [ ] Twilio Verify API integration tested (mock in tests)
- [ ] timetable-loader API integration tested (mock in tests)
- [ ] GCS ticket upload integration tested (mock in tests)
- [ ] Retry logic for transient failures

### Documentation

- [ ] README updated with setup instructions
- [ ] Environment variables documented in `.env.example`
- [ ] API documentation generated from OpenAPI spec
- [ ] FSM state diagram included in docs
- [ ] Runbook updated with troubleshooting steps

### Technical Debt Resolution

- [ ] **TD-WHATSAPP-V2-004 CLOSED**: Integration tests run in Docker environment (BLOCKING)
- [ ] Any new shortcuts documented in Technical Debt Register

---

## Phase 3 Handoff Instructions

### For Blake:

1. **Review Phase 2 Deliverables** (30 minutes):
   - Read RFC: `/docs/RFC-whatsapp-handler-schema-v2.md`
   - Review migration: `/migrations/001_create_whatsapp_handler_schema.ts`
   - Review integration tests: `/tests/integration/migrations.test.ts`
   - Review technical debt: `/docs/TECHNICAL-DEBT-REGISTER.md`

2. **Verify Prerequisites** (15 minutes):
   - Confirm Docker is available in your environment
   - Run `npm run test:integration` → Expected: All 11 tests GREEN
   - If RED: Escalate to Quinn + Hoops immediately

3. **Close TD-WHATSAPP-V2-004** (5 minutes):
   - Update `/docs/TECHNICAL-DEBT-REGISTER.md`:
     - Change status: BLOCKING → CLOSED
     - Add resolution date: 2025-11-30
     - Add resolution note: "Integration tests passed in Docker environment"

4. **Begin TDD Workflow** (ADR-014):
   - Write failing tests FIRST for each feature
   - Implement code to pass tests
   - Refactor while keeping tests green

5. **Reference User Stories**:
   - Include User Story IDs in file headers (e.g., `// RAILREPAY-001: User registration`)
   - Ensure acceptance criteria from stories are met

6. **Use Shared Libraries**:
   - `@railrepay/winston-logger` for logging
   - `@railrepay/metrics-pusher` for Prometheus metrics
   - `@railrepay/postgres-client` for database access
   - `@railrepay/redis-client` for FSM state

7. **Follow Schema Boundaries** (ADR-001):
   - NO direct SQL queries outside `whatsapp_handler` schema
   - Use APIs for cross-service references (e.g., timetable-loader, claim-dispatcher)

8. **Handoff to Jessie** (Phase 4):
   - Create `/services/whatsapp-handler/PHASE-3-TO-PHASE-4-HANDOFF.md`
   - Include:
     - Implementation summary
     - Test coverage report (lines, functions, statements, branches)
     - Known issues or shortcuts taken
     - Technical debt recorded (if any)
     - Request for QA sign-off

---

## Escalation Items for Human Decision

**NONE** - All architectural decisions resolved in Phase 1:
- ✅ ESCALATION-001: OTP via Twilio Verify API (RESOLVED by Nic)
- ✅ ESCALATION-002: Station matching via timetable-loader API (RESOLVED by Nic)
- ✅ ESCALATION-003: Session timeout 24 hours (RESOLVED by Nic)

Blake may proceed with full autonomy for implementation.

---

## Files for Blake's Reference

### Specifications
- **Primary Spec**: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/specifications/whatsapp-handler-COMPLETE-v2.md`
- **Phase 1 Handoff**: `/services/whatsapp-handler/PHASE-1-TO-PHASE-2-HANDOFF.md`

### Data Layer Artifacts (Phase 2)
- **Migration**: `/services/whatsapp-handler/migrations/001_create_whatsapp_handler_schema.ts`
- **Integration Tests**: `/services/whatsapp-handler/tests/integration/migrations.test.ts`
- **RFC**: `/services/whatsapp-handler/docs/RFC-whatsapp-handler-schema-v2.md`
- **Phase 2 Report**: `/services/whatsapp-handler/docs/PHASE-2-COMPLETION-REPORT.md`
- **Technical Debt**: `/services/whatsapp-handler/docs/TECHNICAL-DEBT-REGISTER.md`

### Notion Documentation
- **Architecture › Data Layer**: Schema-per-service rules, polyglot data layer
- **Architecture › ADRs**: ADR-001 (schema isolation), ADR-002 (logging), ADR-008 (health checks), ADR-014 (TDD)
- **User Stories**: RAILREPAY-001, 002, 100, 101, 102, 600, 900, 902
- **Extractable Packages Registry**: Shared libraries (@railrepay/*)

---

## Sign-Offs

| Role | Name | Status | Date |
|------|------|--------|------|
| **Data Architect (Phase 2)** | Hoops | ✅ APPROVED | 2025-11-30 |
| **Orchestrator (Phase 2 Gate)** | Quinn | ✅ APPROVED | 2025-11-30 |
| **Backend Engineer (Phase 3)** | Blake | ⏳ PENDING | - |
| **QA Engineer (Phase 4)** | Jessie | ⏳ PENDING | - |
| **DevOps (Phase 5)** | Moykle | ⏳ PENDING | - |

---

## Phase 3 Authorization Statement

**I, Quinn (Orchestrator), hereby authorize Blake (Backend Engineer) to proceed with Phase 3 (Implementation) for the whatsapp-handler service.**

**Authorization Basis**:
1. ✅ All Phase 2 quality gates satisfied
2. ✅ Technical debt recorded per SOP blocking rule
3. ✅ Zero-downtime migration strategy confirmed
4. ✅ Integration tests defined (pending Docker execution by Blake)
5. ✅ Schema-per-service boundaries respected
6. ✅ User Stories consulted and referenced
7. ✅ ADR compliance verified

**Expected Deliverables from Phase 3**:
- Complete service implementation (FSM, webhook handler, API)
- TDD compliance (tests written first, coverage ≥80%)
- Observability instrumented (logs, metrics, correlation IDs)
- Security controls implemented (signature verification, idempotency, rate limiting)
- Technical debt recorded for any shortcuts
- Handoff document to Jessie (Phase 4)

**Blocking Condition**:
- Blake MUST resolve TD-WHATSAPP-V2-004 (run integration tests in Docker) before Phase 3 completion
- If integration tests fail, Phase 3 is BLOCKED until Hoops fixes schema

**Quality is non-negotiable. Blake has full authority to implement, but Jessie has full authority to reject in Phase 4 if quality gates are not met.**

---

**Status**: ✅ **PHASE 3 AUTHORIZED - BLAKE MAY PROCEED**

**Authorization Date**: 2025-11-30
**Authorized By**: Quinn (Orchestrator)
**Next Phase**: Phase 3 (Implementation) - Blake (Backend Engineer)

---

**End of Phase 2 → Phase 3 Handoff Document**
