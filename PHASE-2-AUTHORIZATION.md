# PHASE 2 AUTHORIZATION - whatsapp-handler

**Date**: 2025-11-30
**Issued By**: Quinn (Product Owner & Chief Orchestrator)
**Authorized Agent**: Hoops (Data Architect)
**Authority**: Standard Operating Procedures § Phase 1.5 (Phase Transition Gates)

---

## AUTHORIZATION STATEMENT

**I, Quinn, Product Owner and Chief Orchestrator for RailRepay MVP, hereby AUTHORIZE Hoops (Data Architect) to proceed with Phase 2 (Data Layer) work for the whatsapp-handler service.**

### Prerequisites Verified ✅

Per **Standard Operating Procedures § Phase 0 (Prerequisites Verification)**:

- ✅ Railway PostgreSQL instance available and accessible
- ✅ Railway Redis instance available and accessible
- ✅ DATABASE_URL and DATABASE_SCHEMA environment variables confirmed
- ✅ All shared libraries available (@railrepay/postgres-client, @railrepay/winston-logger)
- ✅ Testcontainers PostgreSQL configured for integration tests
- ✅ node-pg-migrate installed and configured

### Phase 1 Gate Criteria Met ✅

Per **Standard Operating Procedures § Phase 1 → Phase 2 Transition**:

- ✅ **User Stories Consulted** (SOP § 1.2 MANDATORY):
  - 8 user stories identified and referenced (RAILREPAY-001, 002, 100, 101, 102, 600, 900, 902)
  - Acceptance criteria extracted from each story
  - User Story Traceability Matrix created in specification

- ✅ **ADR Review Complete** (SOP § 1.0 MANDATORY):
  - All 14 ADRs reviewed and applicability assessed
  - ADR compliance checklist created
  - ADR-001 (Schema-per-service), ADR-003 (node-pg-migrate), ADR-014 (TDD) applicable to Phase 2

- ✅ **Service Layer Description Reviewed**:
  - Notion › Service Layer § whatsapp-handler v3.0 analyzed
  - Service purpose, API contracts, and data requirements extracted

- ✅ **Data Layer Schema Requirements Identified**:
  - 3 tables required: users, user_preferences, outbox_events
  - Schema isolation boundary confirmed (whatsapp_handler schema)
  - NO cross-service foreign keys (ADR-001 compliance)

- ✅ **Complete Definition of Done Drafted**:
  - 60+ checklist items covering all phases
  - Phase 2-specific DoD included in handoff document

- ✅ **Specification Document Approved by Quinn**:
  - Location: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/specifications/whatsapp-handler-COMPLETE-v2.md`
  - Status: APPROVED
  - Version: 2.0 (complete remediation)

- ✅ **All Escalation Items Resolved by Human**:
  - ESCALATION-001 (OTP Provider): Twilio Verify API (RESOLVED 2025-11-30)
  - ESCALATION-002 (Station Matching): timetable-loader API (RESOLVED 2025-11-30)
  - ESCALATION-003 (Session Timeout): 24 hours (RESOLVED 2025-11-30)

### Blocking Rules Satisfied ✅

Per **Standard Operating Procedures § Phase Blocking Rules**:

- ✅ **Phase 1 cannot start without Phase 0 complete**: Phase 0 prerequisites verified
- ✅ **Phase 2 cannot start without complete specification**: Specification v2.0 approved
- ✅ **Phase 2 cannot start without escalations resolved**: All 3 escalations resolved by Nic

---

## AUTHORIZATION SCOPE

Hoops is AUTHORIZED to perform the following Phase 2 activities:

### 1. RFC Document Creation
- Create RFC documenting business context, schema design, and alternatives
- Reference User Stories (RAILREPAY-001, 002, 100, 600) for business justification
- Explain why FSM state is in Redis, NOT PostgreSQL (performance rationale)
- Explain why NO custom OTP table (Twilio Verify decision)
- Explain why NO station cache table (timetable-loader API decision)

### 2. Integration Test Development (TDD)
- Write FAILING integration tests using Testcontainers PostgreSQL
- Tests must cover:
  - User creation with phone_number UNIQUE constraint
  - User preferences FK cascade delete
  - Outbox events index on published_at IS NULL
  - Schema isolation (NO cross-schema queries)
- Tests must FAIL before migration, PASS after migration

### 3. Migration File Implementation
- Create TypeScript migration using node-pg-migrate
- Implement UP function (create schema, tables, indexes)
- Implement DOWN function (drop tables, drop schema)
- Ensure idempotency (IF NOT EXISTS / IF EXISTS)
- Follow zero-downtime principles (even though new schema)

### 4. Query Plan Analysis
- Run EXPLAIN ANALYZE on common queries
- Document index usage and execution time
- Verify performance targets (<100ms p99)

### 5. Documentation Updates
- Update README.md with database schema section
- Create ERD.md with entity-relationship diagram
- Create QUERY-PLANS.md with performance analysis

---

## SCHEMA SPECIFICATION SUMMARY

For Hoops' reference, here is the complete schema specification:

### Schema: whatsapp_handler

#### Table 1: users
**Purpose**: Store registered users with verification status

**Columns**:
- `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
- `phone_number` VARCHAR(20) UNIQUE NOT NULL (E.164 format)
- `verified_at` TIMESTAMPTZ (NULL until OTP verified)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()

**Indexes**:
- PRIMARY KEY on id (automatic)
- UNIQUE index on phone_number (automatic)
- B-tree index on phone_number (idx_users_phone) for fast lookup
- Partial index on verified_at WHERE verified_at IS NOT NULL (idx_users_verified)

**Constraints**:
- phone_number must be E.164 format (validation in application layer)
- verified_at can be NULL (user not yet verified)

**Cross-Service References**:
- This table is SOURCE OF TRUTH for user_id
- journey-matcher validates user_id via GET /api/v1/users/:id (NO FK)

#### Table 2: user_preferences
**Purpose**: Store user preferences (language, notification settings)

**Columns**:
- `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
- `user_id` UUID NOT NULL REFERENCES whatsapp_handler.users(id) ON DELETE CASCADE
- `preference_key` VARCHAR(50) NOT NULL
- `preference_value` TEXT
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- UNIQUE(user_id, preference_key)

**Indexes**:
- PRIMARY KEY on id (automatic)
- B-tree index on user_id (idx_user_preferences_user) for FK joins
- UNIQUE index on (user_id, preference_key) (automatic)

**Foreign Keys**:
- user_id → users(id) ON DELETE CASCADE (SAME SCHEMA, FK allowed per ADR-001)

**Example Preferences**:
- preference_key="language", preference_value="en"
- preference_key="notifications_enabled", preference_value="true"

#### Table 3: outbox_events
**Purpose**: Transactional outbox pattern for event publishing

**Columns**:
- `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
- `aggregate_id` UUID NOT NULL (user_id reference, NO FK)
- `event_type` VARCHAR(100) NOT NULL
- `event_version` VARCHAR(10) NOT NULL DEFAULT '1.0'
- `payload` JSONB NOT NULL
- `metadata` JSONB
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `published_at` TIMESTAMPTZ (NULL until published by outbox-relay)

**Indexes**:
- PRIMARY KEY on id (automatic)
- Partial index on published_at WHERE published_at IS NULL (idx_outbox_events_published)
- B-tree index on created_at (idx_outbox_events_created)

**Event Types**:
- `user.registered`: New user completed OTP verification
- `user.session.started`: Returning user authenticated
- `journey.confirmed`: User confirmed journey details

**NO Foreign Key on aggregate_id**:
- aggregate_id is a UUID reference to users(id)
- NO FK constraint (outbox pattern requires loose coupling)
- Orphaned events are acceptable (user deleted, event remains for audit)

---

## ARCHITECTURAL DECISIONS IMPACT ON SCHEMA

### ESCALATION-001: OTP Provider = Twilio Verify API
**Impact on Schema**:
- ✅ NO custom OTP table needed
- ✅ NO otp_code, otp_attempts, otp_created_at columns in users table
- ✅ Twilio Verify API handles OTP storage externally
- ✅ users.verified_at is set after Twilio Verify confirms OTP

### ESCALATION-002: Station Matching = timetable-loader API
**Impact on Schema**:
- ✅ NO station cache table in whatsapp_handler schema
- ✅ NO station_name, station_crs_code, station_aliases columns
- ✅ All station lookups via API call to timetable-loader
- ✅ Simpler schema, reduced data duplication

### ESCALATION-003: Session Timeout = 24 hours
**Impact on Schema**:
- ✅ NO session_timeout column in users table
- ✅ Session timeout is configured via REDIS_CACHE_TTL_SECONDS=86400
- ✅ Session state is stored in Redis, NOT PostgreSQL
- ✅ users.verified_at remains permanent (never expires)

---

## WHAT HOOPS MUST DELIVER

### Phase 2 Deliverables (MANDATORY)

1. **RFC Document**:
   - `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/docs/RFC-whatsapp-handler-schema.md`
   - Business context referencing User Stories
   - Schema design with rationale
   - Alternatives considered (with architectural decisions explained)

2. **Migration Files**:
   - `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/migrations/TIMESTAMP_create_whatsapp_handler_schema.ts`
   - UP function: Create schema, tables, indexes (idempotent)
   - DOWN function: Drop tables, drop schema (idempotent)

3. **Integration Tests**:
   - `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/tests/integration/database-schema.test.ts`
   - Testcontainers PostgreSQL setup
   - Tests for UNIQUE constraints, FK cascade, indexes
   - All tests FAIL before migration, PASS after migration

4. **Query Plans**:
   - `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/docs/QUERY-PLANS.md`
   - EXPLAIN ANALYZE for common queries
   - Performance validation (<100ms p99)

5. **Documentation Updates**:
   - README.md: Add database schema section
   - ERD.md: Create entity-relationship diagram

### Quality Gates (BLOCKING)

- [ ] **TDD Compliance** (ADR-014): Tests written BEFORE migration code
- [ ] **Schema Isolation** (ADR-001): NO cross-service FKs, schema=whatsapp_handler
- [ ] **Migration Tooling** (ADR-003): node-pg-migrate used (TypeScript, UP/DOWN)
- [ ] **All Tests GREEN**: Integration tests pass after migration applied
- [ ] **Performance Validated**: Query plans show <100ms execution time
- [ ] **Technical Debt Recorded**: Any shortcuts documented in Notion

**BLOCKING RULE**: Phase 3 (Blake) cannot begin until Hoops delivers GREEN migrations.

---

## TIMELINE EXPECTATION

**Expected Duration**: 1-2 work sessions

**Milestones**:
1. Session 1: RFC complete, failing tests written
2. Session 2: Migration implemented, tests GREEN, query plans validated

**Handoff to Blake**: After all Phase 2 quality gates are met and Quinn verifies deliverables.

---

## SIGN-OFF

**Authorized By**: Quinn (Product Owner & Chief Orchestrator)
**Date**: 2025-11-30
**Status**: ✅ PHASE 2 AUTHORIZED

**Quinn's Directive to Hoops**:
> Hoops, you are AUTHORIZED to begin Phase 2 (Data Layer) work for whatsapp-handler. All prerequisites are verified, all escalations are resolved, and the specification is complete. Execute with TDD discipline, ensure schema isolation per ADR-001, and deliver GREEN migrations. Blake is waiting for your deliverables to begin Phase 3 implementation. The quality of this schema will determine the reliability of the entire service. Execute with precision and rigor. Good luck!

**Next Phase**: Phase 3 (Implementation) - Blake will begin AFTER Phase 2 deliverables are complete and Quinn verifies quality gates.

---

**End of Phase 2 Authorization Document**
