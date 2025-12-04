# Phase 1 Handoff to Phase 2
**Date**: 2025-11-30
**Service**: whatsapp-handler
**Feature**: Complete service remediation with full specification
**From**: Quinn (Phase 1 - Specification)
**To**: Hoops (Phase 2 - Data Layer)

---

## Phase 1 Completion Summary

Phase 1 has been completed with all mandatory requirements satisfied:

### Deliverables Completed
1. **Prerequisites Verified** (Phase 0):
   - ✅ Twilio WhatsApp Business Account confirmed
   - ✅ Railway PostgreSQL instance available
   - ✅ Railway Redis instance available
   - ✅ Grafana Cloud observability configured
   - ✅ All required shared libraries available (@railrepay/* packages)

2. **User Stories Consultation** (SOP § 1.2 MANDATORY):
   - ✅ Reviewed User Stories & Requirements Notion page
   - ✅ Identified applicable stories: RAILREPAY-001, 002, 100, 101, 102, 600, 900, 902
   - ✅ Extracted acceptance criteria from stories
   - ✅ Created User Story Traceability Matrix in specification

3. **ADR Review** (SOP § 1.0 MANDATORY):
   - ✅ Reviewed all ADRs (ADR-001 through ADR-014)
   - ✅ Created ADR applicability checklist
   - ✅ Verified compliance with each applicable ADR
   - ✅ Documented ADR-specific requirements in specification

4. **Complete Specification Document**:
   - ✅ Service purpose and business value defined
   - ✅ FSM state machine designed (11 states, Redis-backed)
   - ✅ WhatsApp message templates extracted from User Stories
   - ✅ API contracts documented (inbound webhook, outbound calls)
   - ✅ Security requirements specified (signature verification, idempotency, rate limiting)
   - ✅ Data model requirements defined (3 tables: users, user_preferences, outbox_events)
   - ✅ Non-functional requirements listed (performance SLOs, availability targets)
   - ✅ Complete Definition of Done created

5. **Architectural Decisions Resolved**:
   - ✅ ESCALATION-001: OTP via Twilio Verify API (RESOLVED)
   - ✅ ESCALATION-002: Station matching via timetable-loader API (RESOLVED)
   - ✅ ESCALATION-003: Session timeout 24 hours (RESOLVED)

---

## Artifacts Produced

### Primary Specification Document
**Location**: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/specifications/whatsapp-handler-COMPLETE-v2.md`

**Contents**:
- Executive summary with business value
- User story traceability matrix (8 stories)
- ADR applicability checklist (14 ADRs)
- FSM state diagram with 11 states
- 13 WhatsApp message templates
- 3 database tables with full schema DDL
- API contracts (3 inbound, 4 outbound)
- Security requirements (5 critical controls)
- Non-functional requirements (4 performance targets)
- Complete Definition of Done (60+ checklist items)

### This Handoff Document
**Location**: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/PHASE-1-TO-PHASE-2-HANDOFF.md`

---

## User Stories Addressed

This service implements the following User Stories (per Notion › User Stories & Requirements):

**EPIC 001-099: User Onboarding & Authentication**
- **RAILREPAY-001**: First-time user registration via WhatsApp
  - Acceptance Criteria: WELCOME_FIRST_TIME message within 2 seconds, OTP via Twilio Verify, user record created
- **RAILREPAY-002**: Returning user authentication
  - Acceptance Criteria: Personalized welcome, session created in Redis, NO OTP required (already verified)

**EPIC 100-199: Journey Capture & Management**
- **RAILREPAY-100**: Historic journey entry (date, stations, time)
  - Acceptance Criteria: Multi-state FSM (4 states), journey date within 90 days, delay ≥15 minutes
- **RAILREPAY-101**: Station name resolution (fuzzy matching)
  - Acceptance Criteria: Resolve "Kings X" to KGX, handle ambiguous stations (Richmond → RMD or RMZ)
- **RAILREPAY-102**: Future journey registration
  - Acceptance Criteria: Journey date 0-14 days in future, status=SCHEDULED, automatic claim on delay

**EPIC 600-699: Integration & Webhooks**
- **RAILREPAY-600**: Twilio webhook handler with signature verification
  - Acceptance Criteria: Verify X-Twilio-Signature, idempotency via MessageSid, respond <1 second

**EPIC 900-999: Reliability & Observability**
- **RAILREPAY-900**: Service health checks (ADR-008)
  - Acceptance Criteria: GET /health responds <100ms, checks database + Redis connectivity
- **RAILREPAY-902**: Distributed tracing with correlation IDs (ADR-002)
  - Acceptance Criteria: All logs include correlation_id, propagate to downstream services

---

## Architectural Decisions Made

### ESCALATION-001: OTP Provider ✅ RESOLVED
**Decision**: Use Twilio Verify API

**Rationale** (Nic, 2025-11-30):
- Built-in fraud detection, SMS delivery, and rate limiting worth the cost
- Security benefits outweigh implementation complexity
- Reduces custom code that could introduce vulnerabilities

**Impact on Data Layer**:
- **NO custom OTP table needed** (Twilio handles storage)
- **NO otp:{phone_number} Redis keys** (Twilio Verify API stores codes internally)
- **ADD environment variable**: TWILIO_VERIFY_SERVICE_SID
- users table remains unchanged (phone_number, verified_at are sufficient)

### ESCALATION-002: Station Matching ✅ RESOLVED
**Decision**: API call to timetable-loader

**Rationale** (Nic, 2025-11-30):
- Always fresh data (no cache staleness)
- Simpler code (delegate complexity to timetable-loader)
- 200ms latency is acceptable for user interaction
- Consistent station matching logic across all services

**Impact on Data Layer**:
- **NO local station cache tables** in whatsapp_handler schema
- **NO station-related Redis keys** (use API for every lookup)
- **ADD service dependency**: TIMETABLE_LOADER_BASE_URL
- Error handling: If timetable-loader unavailable, inform user via WhatsApp

### ESCALATION-003: Session Timeout ✅ RESOLVED
**Decision**: Keep 24 hours

**Rationale** (Nic, 2025-11-30):
- Balanced security vs. user experience
- 24 hours is industry standard for mobile app sessions
- WhatsApp is phone-locked, reducing theft risk
- Users can manually logout with "LOGOUT" command

**Impact on Data Layer**:
- **CONFIRM environment variable**: REDIS_CACHE_TTL_SECONDS=86400
- **ADD LOGOUT command** to FSM (implementation in Phase 3)
- **NO changes to user table** (verified_at remains permanent)

---

## Known Issues / Assumptions

### Assumptions Documented
1. **Twilio Webhook Reliability**: Assumed Twilio will retry webhook delivery with exponential backoff. If Twilio fails permanently, user must re-send message.
2. **timetable-loader Availability**: Assumed 99.5% uptime for timetable-loader. If unavailable, user receives error message and must retry.
3. **Redis Persistence**: Assumed Railway Redis has persistence enabled. If Redis data is lost, user sessions expire (acceptable degradation).
4. **Twilio Verify SID**: Assumed Nic will provide TWILIO_VERIFY_SERVICE_SID credential before Phase 5 deployment.

### Deferred to Future Phases
1. **FSM Timeout Handling Edge Cases**: Complex edge cases (e.g., user sends message exactly at 24hr TTL boundary) will be handled in v2 based on production logs.
2. **Station Name Disambiguation UI**: Enhanced UI for ambiguous station resolution (e.g., "Richmond") will be improved in v2 based on user feedback.
3. **LOGOUT Command Implementation**: Detailed implementation of LOGOUT command deferred to Phase 3 (Blake).

### No Known Blockers
- All prerequisites verified
- All escalations resolved by human-in-the-loop (Nic)
- No conflicting requirements identified
- No missing dependencies

---

## Phase 2 Instructions for Hoops

### Objective
Create database migrations for the `whatsapp_handler` schema with three tables:
1. **users**: Store registered users with verification status
2. **user_preferences**: Store user preferences (language, notifications)
3. **outbox_events**: Transactional outbox pattern for event publishing

### Specific Requirements

#### 1. RFC Document (MANDATORY per SOP § 2.1)
Create: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/docs/RFC-whatsapp-handler-schema.md`

**Must Include**:
- **Business Context**: Why these tables are needed (reference User Stories)
- **Schema Design**: DDL for all three tables with rationale
- **Alternatives Considered**:
  - Why FSM state is in Redis, NOT PostgreSQL (Answer: Performance, Redis <50ms vs PostgreSQL ~100ms for session lookups)
  - Why NO custom OTP table (Answer: Twilio Verify handles OTP storage per ESCALATION-001)
  - Why NO station cache table (Answer: API call to timetable-loader per ESCALATION-002)
- **Security Considerations**: PII handling (phone_number), verified_at semantics
- **Performance Analysis**: Index strategy, query plans
- **Zero-Downtime Strategy**: This is a new schema, so expand-migrate-contract not needed, but document how we would add columns in future without downtime

#### 2. Failing Integration Tests (TDD per ADR-014)
Create: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/tests/integration/database-schema.test.ts`

**Tests Must Include**:
- Test: Create user with phone_number, verify UNIQUE constraint prevents duplicates
- Test: Create user_preferences, verify FK cascade delete (delete user → delete preferences)
- Test: Insert outbox_event, verify published_at index (WHERE published_at IS NULL)
- Test: Query user by phone_number, verify index usage (EXPLAIN ANALYZE)
- Test: Verify schema isolation (NO cross-schema foreign keys per ADR-001)

**TDD Requirement**: All tests must FAIL before migration, PASS after migration.

**Testcontainers Configuration**:
- Use Testcontainers PostgreSQL image (postgres:15-alpine)
- Enable uuid-ossp extension in migration
- Run tests in CI with real PostgreSQL instance (not mocks)

#### 3. Migration Files (node-pg-migrate)
Create: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/migrations/TIMESTAMP_create_whatsapp_handler_schema.ts`

**Migration Structure**:
```typescript
export async function up(pgm: MigrationBuilder): Promise<void> {
  // 1. Create schema
  pgm.createSchema('whatsapp_handler', { ifNotExists: true });

  // 2. Enable uuid-ossp extension (if not already enabled)
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

  // 3. Create users table (DDL from specification § Data Model Requirements)
  // 4. Create user_preferences table
  // 5. Create outbox_events table
  // 6. Create indexes
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // 1. Drop indexes
  // 2. Drop tables (CASCADE to handle FK dependencies)
  // 3. Drop schema (CASCADE)
}
```

**Idempotency Requirements**:
- Use `IF NOT EXISTS` for schema, extension, tables
- Use `IF EXISTS` for DROP statements in down() function
- Ensure migration can be run multiple times safely

#### 4. Query Plans (Performance Validation)
Create: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/docs/QUERY-PLANS.md`

**Must Include EXPLAIN ANALYZE for**:
- `SELECT * FROM whatsapp_handler.users WHERE phone_number = '+447700900123';`
  - Expected: Index scan on idx_users_phone, <5ms execution time
- `SELECT * FROM whatsapp_handler.outbox_events WHERE published_at IS NULL ORDER BY created_at LIMIT 100;`
  - Expected: Index scan on idx_outbox_events_published, <10ms execution time
- `DELETE FROM whatsapp_handler.users WHERE id = 'uuid';`
  - Expected: Cascade delete to user_preferences via FK, <20ms execution time

**Performance Targets**:
- All queries <100ms (p99)
- Index scans only (NO sequential scans)

#### 5. ADR Compliance Verification
Verify compliance with:
- **ADR-001**: Schema-per-service isolation (whatsapp_handler schema, NO cross-service FKs)
- **ADR-003**: node-pg-migrate for migrations (TypeScript, UP and DOWN functions)
- **ADR-014**: TDD workflow (tests written BEFORE migration implementation)

#### 6. Documentation Updates
Update:
- `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/README.md`
  - Add "Database Schema" section referencing RFC
  - Add migration instructions (how to run locally, CI)
- `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/docs/ERD.md`
  - Create entity-relationship diagram showing users → user_preferences (1:N)
  - Show outbox_events (no FKs, aggregate_id is UUID reference)

---

## Definition of Done for Phase 2

Hoops must complete the following before handing off to Blake (Phase 3):

### Data Layer Deliverables
- [ ] RFC document created with business context, schema design, alternatives considered
- [ ] Failing integration tests written using Testcontainers PostgreSQL
- [ ] Forward migration (UP) created with idempotent DDL
- [ ] Rollback migration (DOWN) created with idempotent DROP statements
- [ ] All integration tests PASS after migration applied
- [ ] Query plans documented showing index usage and <100ms performance
- [ ] Zero-downtime strategy documented (for future column additions)

### ADR Compliance
- [ ] ADR-001: Schema isolation verified (NO cross-service FKs)
- [ ] ADR-003: node-pg-migrate used (TypeScript, UP/DOWN functions)
- [ ] ADR-014: TDD workflow followed (tests written FIRST, then migration)

### Documentation
- [ ] README.md updated with database schema section
- [ ] ERD.md created with entity-relationship diagram
- [ ] QUERY-PLANS.md created with EXPLAIN ANALYZE results

### Testing
- [ ] Unit tests for migration logic (if applicable)
- [ ] Integration tests for schema constraints (UNIQUE, FK, NOT NULL)
- [ ] Integration tests for index usage
- [ ] All tests GREEN in CI
- [ ] Coverage ≥80% for migration code (per ADR-014)

### Code Quality
- [ ] TypeScript types precise (no `any`)
- [ ] ESLint clean
- [ ] No TODO comments
- [ ] Code reviewed by at least one other agent (Jessie will review in Phase 4)

### Technical Debt Recording (MANDATORY per SOP § 6.3)
- [ ] Any shortcuts documented in Notion › Technical Debt Register
- [ ] Deferred work itemized with business justification
- [ ] Coverage gaps recorded (if any)

### Blocking Rule Verification
- [ ] **BLOCKING RULE**: Phase 3 (Blake) cannot begin without GREEN migrations from Phase 2
- [ ] **BLOCKING RULE**: Phase 2 cannot complete without technical debt recorded (if any)

---

## Sign-Off

**Phase 1 Owner**: Quinn (Product Owner & Chief Orchestrator)
**Status**: ✅ APPROVED

**Quinn Verification Checklist**:
- [x] Phase 0 prerequisites verified (all external accounts and credentials ready)
- [x] User Stories consulted (8 stories referenced)
- [x] ADR review complete (14 ADRs assessed)
- [x] Complete specification document created
- [x] All escalations resolved by human-in-the-loop (Nic)
- [x] Definition of Done for Phase 2 created
- [x] Handoff package complete

**Quality Gate**: ✅ PHASE 1 GATE PASSED

**Authorized to Proceed**: **YES**

**Next Phase**: Phase 2 (Data Layer) - Hoops is AUTHORIZED to begin work immediately.

---

## How to Invoke Hoops

**For Claude Code / Human-in-the-Loop**:

Use the Task tool to invoke the `hoops-data-architect` sub-agent:

```
Task tool → subagent_type: "hoops-data-architect"
```

**Provide Hoops with**:
1. This handoff document (PHASE-1-TO-PHASE-2-HANDOFF.md)
2. Complete specification (/specifications/whatsapp-handler-COMPLETE-v2.md)
3. Notion links:
   - Architecture › Data Layer § whatsapp_handler schema
   - Architecture › ADRs (ADR-001, ADR-003, ADR-014)
   - User Stories & Requirements (RAILREPAY-001, 002, 100, 600)

**Expected Hoops Deliverable**:
- RFC document
- Migration files (UP and DOWN)
- Failing integration tests → GREEN after migration
- Query plans showing performance
- Documentation updates

**Timeline Expectation**: Phase 2 should complete within 1-2 work sessions (Hoops is focused on data layer only).

---

**End of Phase 1 → Phase 2 Handoff Document**

**Quinn's Final Instruction to Hoops**:
> Hoops, you are AUTHORIZED to begin Phase 2 (Data Layer) work for whatsapp-handler. This is a complete remediation with full specification, resolved architectural decisions, and user story alignment. Create the RFC, write failing tests, implement migrations, and ensure all quality gates are met. Blake is waiting for your GREEN migrations to begin Phase 3 implementation. Execute with precision and discipline. Good luck!
