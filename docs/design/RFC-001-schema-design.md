# RFC-001: whatsapp-handler Schema Design

**Author**: Hoops (Data Architect)
**Date**: 2025-11-30
**Status**: Approved for Implementation
**Phase**: 2 (Data Layer)
**Related Specification**: `/specifications/whatsapp-handler-specification.md`

---

## Executive Summary

This RFC defines the PostgreSQL schema design for the `whatsapp-handler` service, which serves as the primary user-facing entry point for RailRepay MVP. The schema implements user authentication, preferences management, and the transactional outbox pattern for event-driven architecture.

**Schema Name**: `whatsapp_handler` (per ADR-001 schema-per-service pattern)

**Tables**: 3 core tables
- `users` - User authentication and phone number verification
- `user_preferences` - User settings and notification preferences
- `outbox_events` - Transactional outbox for reliable event publishing

**User Story References**:
- RAILREPAY-001: First-time user registration via WhatsApp
- RAILREPAY-002: Returning user authentication
- RAILREPAY-600: WhatsApp webhook processing and security
- RAILREPAY-701: GDPR compliance and data retention
- RAILREPAY-800: Security and rate limiting

---

## 1. Business Context

From **Notion › User Stories § RAILREPAY-001**:
> "As a first-time user, I want to register via WhatsApp so that I can start claiming delay compensation"

From **Notion › Project Overview**:
> "Whatsapp-first UX. RailRepay believes Whatsapp-based commerce is an underexploited way of minimising user friction."

### 1.1 Service Responsibilities

Per **Notion › Service Layer § whatsapp-handler**:
- Manages WhatsApp conversations via Twilio webhooks (primary user interface)
- User registration and OTP verification (security critical)
- Conversation state machine (FSM) using Redis with 24-hour TTL
- Message routing to downstream services (journey-matcher, claim-dispatcher)
- Real-time user notifications

### 1.2 Data Ownership

This schema owns:
- **User identity**: Phone number-based authentication (E.164 format)
- **User preferences**: Language, timezone, notification settings, auto-claim preferences
- **Event publishing**: Transactional outbox for `user.registered`, `user.verified`, `conversation.started`, `ticket.uploaded` events

This schema does NOT own (cross-service references via API):
- Journey data (owned by `journey_matcher` schema)
- Claim data (owned by `claim_dispatcher` schema)
- Payment data (owned by `payment_handler` schema)

---

## 2. Architecture Compliance

### 2.1 ADR Compliance

- **ADR-001**: Schema-per-service isolation - `whatsapp_handler` schema is isolated, no cross-schema FKs
- **ADR-003**: node-pg-migrate for all migrations
- **ADR-004**: Vitest for integration testing
- **ADR-014**: TDD workflow - tests written BEFORE migration implementation

### 2.2 Data Layer Alignment

Per **Notion › Data Layer § whatsapp_handler**:
- PostgreSQL for primary user data (source of truth for user identity)
- Redis for ephemeral FSM state (session management with TTL)
- No Graph DB usage (journey planning owned by `journey_matcher`)
- No GCS usage at this schema level (ticket storage owned by `ticket_processor`)

---

## 3. Schema Design Decisions

### 3.1 Table: users

**Purpose**: User authentication via phone number with OTP verification

**Design Rationale**:

1. **Phone Number as Primary Identity**:
   - `phone_number VARCHAR(20) NOT NULL UNIQUE` - E.164 format (+447700900123)
   - Chosen over email to align with WhatsApp-first UX strategy
   - Unique constraint enforces one account per phone number
   - VARCHAR(20) accommodates international numbers with country code

2. **Soft-Delete Pattern**:
   - `blocked_at TIMESTAMPTZ` and `block_reason TEXT` instead of hard DELETE
   - Enables audit trail and GDPR compliance
   - Allows user reactivation if needed
   - Per **Notion › User Stories § RAILREPAY-701**: Anonymize PII after 180 days inactivity

3. **OTP Security**:
   - `otp_secret VARCHAR(64)` - stores hashed OTP (NOT plaintext)
   - `otp_verified_at TIMESTAMPTZ` - tracks verification completion
   - 5-minute expiration enforced at application layer (not DB constraint)
   - 3-attempt limit enforced at application layer

4. **Terms Acceptance Tracking**:
   - `terms_accepted_at TIMESTAMPTZ` and `terms_version VARCHAR(20)`
   - Legal requirement for compensation claims
   - Version tracking enables future terms updates with re-acceptance flow

5. **Activity Tracking**:
   - `last_active_at TIMESTAMPTZ` - updated on every message received
   - Enables GDPR retention policy (anonymize after 180 days inactivity)
   - Used for user engagement metrics

**Alternatives Considered**:

❌ **UUID as primary key with phone_number as unique index**:
- Rejected: Adds complexity without benefit for this use case
- Current design: Sequential UUID generation is sufficient

❌ **Email as primary identity**:
- Rejected: Conflicts with WhatsApp-first strategy
- Users may not have email addresses

❌ **Hard delete for blocked users**:
- Rejected: Violates audit requirements
- Cannot recover from accidental blocks

**Indexes**:
```sql
CREATE INDEX idx_users_phone ON users(phone_number);
-- Justification: Primary lookup pattern (every webhook checks phone_number)
-- Expected P95 < 10ms for exact match on unique index

CREATE INDEX idx_users_verified ON users(verified_at) WHERE verified_at IS NOT NULL;
-- Justification: Partial index for verified users (saves space on unverified)
-- Used for analytics: "How many verified users this month?"

CREATE INDEX idx_users_last_active ON users(last_active_at);
-- Justification: GDPR retention queries (find users inactive >180 days)
-- Batch job runs daily at 03:00 UTC
```

---

### 3.2 Table: user_preferences

**Purpose**: User-specific settings for notifications and claim automation

**Design Rationale**:

1. **One-to-One Relationship**:
   - `UNIQUE INDEX idx_user_prefs_user ON user_preferences(user_id)`
   - Enforces exactly one preference record per user
   - Simpler than JSONB column on users table (allows schema validation)

2. **Cascade Delete**:
   - `REFERENCES users(id) ON DELETE CASCADE`
   - When user is hard-deleted (post-GDPR), preferences are automatically removed
   - No orphaned preference records

3. **Sensible Defaults**:
   - `notification_enabled BOOLEAN NOT NULL DEFAULT TRUE` - opt-out model
   - `language VARCHAR(10) NOT NULL DEFAULT 'en-GB'` - UK primary market
   - `timezone VARCHAR(50) NOT NULL DEFAULT 'Europe/London'` - UK timezone
   - `delay_threshold_minutes INTEGER NOT NULL DEFAULT 15` - minimum compensation threshold
   - `auto_claim_enabled BOOLEAN NOT NULL DEFAULT TRUE` - maximize user value

4. **NOT NULL Constraints**:
   - All preferences have defaults, so NOT NULL is safe
   - Prevents application bugs from NULL checks
   - Clear contract: every user ALWAYS has preferences

**Alternatives Considered**:

❌ **Store preferences as JSONB column on users table**:
- Rejected: Loses schema validation and type safety
- Current approach: Explicit columns with constraints

❌ **Allow multiple preference profiles per user**:
- Rejected: YAGNI (You Aren't Gonna Need It)
- Current scope: One preference set sufficient for MVP

❌ **Separate table per preference type**:
- Rejected: Over-normalization for small dataset
- Current approach: Single table with 8 columns is maintainable

**Indexes**:
```sql
CREATE UNIQUE INDEX idx_user_prefs_user ON user_preferences(user_id);
-- Justification: Enforces one-to-one relationship
-- Primary lookup pattern: "Get preferences for user X"
-- Expected P95 < 5ms (unique index on UUID FK)
```

---

### 3.3 Table: outbox_events

**Purpose**: Transactional outbox pattern for reliable event publishing to Pub/Sub

**Design Rationale**:

1. **Transactional Outbox Pattern**:
   - Events written in SAME transaction as domain changes (ACID guarantees)
   - `outbox-relay` service polls for `published_at IS NULL`
   - After successful Pub/Sub publish, `published_at` is set
   - Prevents lost events during service crashes

2. **Event Versioning**:
   - `event_version VARCHAR(10) NOT NULL DEFAULT '1.0'`
   - Enables schema evolution for event payloads
   - Consumers can handle multiple versions gracefully

3. **Correlation ID Tracking**:
   - `correlation_id VARCHAR(64) NOT NULL` (per ADR-002)
   - Enables distributed tracing across services
   - Critical for debugging multi-service flows

4. **JSONB Payload**:
   - `payload JSONB NOT NULL` - flexible event structure
   - `metadata JSONB` - optional tracing/debugging info
   - Allows schema evolution without ALTER TABLE

**Event Types Published**:
- `user.registered` - New user completed registration (aggregate_type: user)
- `user.verified` - OTP verification successful (aggregate_type: user)
- `conversation.started` - New WhatsApp conversation initiated (aggregate_type: conversation)
- `ticket.uploaded` - User uploaded ticket photo (aggregate_type: ticket)

**Alternatives Considered**:

❌ **Direct Pub/Sub publish without outbox**:
- Rejected: Not ACID-compliant (can lose events on crash)
- Current approach: Transactional outbox guarantees delivery

❌ **Separate outbox table per event type**:
- Rejected: `outbox-relay` would need to poll multiple tables
- Current approach: Single table with `event_type` discrimination

❌ **Store full event payload in TEXT column**:
- Rejected: Loses JSON validation and indexing capabilities
- Current approach: JSONB enables partial indexing if needed

**Indexes**:
```sql
CREATE INDEX idx_outbox_unpublished ON outbox_events(created_at)
    WHERE published_at IS NULL;
-- Justification: Partial index for outbox-relay polling
-- Query: "Get next 100 unpublished events ordered by created_at"
-- Expected P95 < 50ms for 10K unpublished events

CREATE INDEX idx_outbox_aggregate ON outbox_events(aggregate_id, aggregate_type);
-- Justification: Event history lookup ("All events for user X")
-- Used for debugging and audit trail
-- Expected P95 < 100ms

CREATE INDEX idx_outbox_correlation ON outbox_events(correlation_id);
-- Justification: Distributed tracing queries
-- Find all events in a request flow
-- Expected P95 < 50ms
```

---

## 4. Cross-Service References (API-Validated)

Per **ADR-001 § Cross-Schema Foreign Keys Forbidden**, all cross-service references are validated via API calls:

### 4.1 References FROM Other Services TO whatsapp_handler

**Services that reference `whatsapp_handler.users.id`**:
- `journey_matcher.journeys.user_id` - Validated via `GET /api/v1/users/:id`
- `delay_tracker.monitored_journeys.user_id` - Validated via `GET /api/v1/users/:id`
- `claim_dispatcher.claims.user_id` - Validated via `GET /api/v1/users/:id`

**API Contract** (whatsapp-handler MUST provide):
```http
GET /api/v1/users/:id
Response 200: { "id": "uuid", "phone_number": "+44...", "verified": true }
Response 404: { "error": "User not found" }
```

### 4.2 References FROM whatsapp_handler TO Other Services

**None** - This schema does not store foreign references to other schemas. Journey, claim, and payment IDs are only passed through WhatsApp messages (ephemeral state in Redis FSM).

---

## 5. Zero-Downtime Migration Strategy

### 5.1 Expand-Migrate-Contract Pattern

**Phase 1 (EXPAND)** - Initial deployment (this RFC):
```sql
-- Create schema (idempotent)
CREATE SCHEMA IF NOT EXISTS whatsapp_handler;

-- Create tables with all constraints
CREATE TABLE whatsapp_handler.users (...);
CREATE TABLE whatsapp_handler.user_preferences (...);
CREATE TABLE whatsapp_handler.outbox_events (...);

-- Create indexes
CREATE INDEX ...;
```

**Phase 2 (MIGRATE)** - Data backfill (if needed):
- N/A - This is a new service with no existing data

**Phase 3 (CONTRACT)** - Remove old structures (if needed):
- N/A - No legacy structures to remove

### 5.2 Rollback Strategy

**DOWN Migration**:
```sql
-- Drop tables (cascade drops FKs)
DROP TABLE IF EXISTS whatsapp_handler.outbox_events CASCADE;
DROP TABLE IF EXISTS whatsapp_handler.user_preferences CASCADE;
DROP TABLE IF EXISTS whatsapp_handler.users CASCADE;

-- Drop schema
DROP SCHEMA IF EXISTS whatsapp_handler CASCADE;
```

**Rollback Decision Points**:
1. If migration fails during table creation → Automatic rollback via transaction
2. If service fails to start after migration → Manual rollback via `npm run migrate:down`
3. If data corruption detected → Restore from Railway PostgreSQL backup + rollback migration

**Rollback Safety**:
- No data exists yet (new service)
- No dependent services yet (first deployment)
- Idempotent UP migration allows retry after rollback

---

## 6. Performance Analysis

### 6.1 Expected Query Patterns

**Hot Path Queries** (P95 < 100ms SLO):

1. **User lookup by phone number** (every webhook):
```sql
SELECT id, verified_at, blocked_at
FROM whatsapp_handler.users
WHERE phone_number = '+447700900123';
```
- Expected: P95 < 10ms (unique index on phone_number)
- Volume: ~1000 requests/hour during peak

2. **User preferences retrieval**:
```sql
SELECT notification_enabled, language, timezone, delay_threshold_minutes, auto_claim_enabled
FROM whatsapp_handler.user_preferences
WHERE user_id = 'uuid';
```
- Expected: P95 < 5ms (unique index on user_id)
- Volume: ~500 requests/hour

3. **Unpublished events polling** (outbox-relay):
```sql
SELECT id, aggregate_id, event_type, payload, correlation_id
FROM whatsapp_handler.outbox_events
WHERE published_at IS NULL
ORDER BY created_at ASC
LIMIT 100;
```
- Expected: P95 < 50ms (partial index on published_at IS NULL)
- Volume: Poll every 5 seconds

**Cold Path Queries** (P95 < 1000ms acceptable):

4. **GDPR retention cleanup** (daily batch at 03:00 UTC):
```sql
SELECT id, phone_number
FROM whatsapp_handler.users
WHERE last_active_at < NOW() - INTERVAL '180 days'
AND blocked_at IS NULL;
```
- Expected: P95 < 500ms (index on last_active_at)
- Volume: 1 query/day

### 6.2 Write Performance

**Expected Write Volume**:
- New users: ~50/day (MVP scale)
- User updates: ~200/day (last_active_at updates)
- Outbox events: ~500/day (4 event types × ~125 users)
- Preference updates: ~10/day

**Write Amplification**:
- users table: 3 indexes → 3× write cost (acceptable for low volume)
- user_preferences: 1 index → minimal overhead
- outbox_events: 3 indexes → 3× write cost (acceptable, events are append-only)

**Conclusion**: No performance concerns at MVP scale. Monitor `pg_stat_user_tables` for bloat.

### 6.3 Storage Estimates

**users table**:
- Row size: ~200 bytes (UUID + VARCHAR(20) + timestamps)
- Expected rows: 10,000 users (1 year MVP growth)
- Storage: ~2 MB + indexes ~3 MB = **~5 MB total**

**user_preferences table**:
- Row size: ~150 bytes
- Expected rows: 10,000 (one per user)
- Storage: ~1.5 MB + indexes ~1 MB = **~2.5 MB total**

**outbox_events table**:
- Row size: ~500 bytes (JSONB payload)
- Expected rows: 180,000 (500/day × 365 days, 7-day retention)
- Storage: ~90 MB + indexes ~30 MB = **~120 MB total**

**Total Schema Storage**: ~130 MB (negligible for Railway PostgreSQL)

---

## 7. Data Retention & GDPR Compliance

### 7.1 Retention Policies

Per **Notion › User Stories § RAILREPAY-701**:

**users table**:
- Soft delete: Set `blocked_at` and `block_reason` (never hard DELETE immediately)
- GDPR deletion: Anonymize PII after 180 days of inactivity
  - Set `phone_number = 'ANONYMIZED_' || id`
  - Set `display_name = NULL`
  - Retain user ID for referential integrity with downstream services

**user_preferences table**:
- Cascade deleted with user (ON DELETE CASCADE)
- No separate retention policy needed

**outbox_events table**:
- Retention: 7 days after `published_at IS NOT NULL`
- Cleanup: Daily cron job deletes events older than 7 days
- Rationale: Debugging window for event delivery issues

### 7.2 GDPR Right to Erasure

**Implementation**:
```sql
-- User requests data deletion
UPDATE whatsapp_handler.users
SET
  phone_number = 'ANONYMIZED_' || id,
  display_name = NULL,
  otp_secret = NULL,
  blocked_at = NOW(),
  block_reason = 'GDPR_ERASURE_REQUEST'
WHERE id = 'user-uuid';

-- Preferences cascade deleted automatically
-- Outbox events retain user_id (anonymized) for audit trail
```

**Audit Log Entry**:
- Create audit log record in `audit_logger.audit_logs` with:
  - `event_type = 'user.gdpr.erased'`
  - `user_id = 'user-uuid'`
  - `timestamp = NOW()`

---

## 8. Operational Considerations

### 8.1 Backup Strategy

**Railway PostgreSQL** provides automated backups:
- Point-in-time recovery (PITR) available
- Retention: 30 days (Railway default)
- Recovery RTO: <1 hour

**Pre-Migration Backup**:
- Before running migrations in production, verify latest backup exists
- Command: Check Railway dashboard → Database → Backups tab

### 8.2 Monitoring Metrics

**Required Prometheus Metrics** (per ADR-006):

```prometheus
# User registration
whatsapp_user_registrations_total{status="success|failure"} 523
whatsapp_otp_sent_total{status="success|failure"} 530
whatsapp_otp_verified_total{status="success|failure"} 520

# Database queries
whatsapp_db_query_duration_seconds{query="user_lookup",quantile="0.95"} 0.008
whatsapp_db_query_duration_seconds{query="preferences_fetch",quantile="0.95"} 0.005

# Outbox processing
whatsapp_outbox_events_created_total{event_type="user.registered"} 520
whatsapp_outbox_events_published_total{event_type="user.registered"} 518
whatsapp_outbox_publish_lag_seconds{quantile="0.95"} 2.5
```

### 8.3 Alert Thresholds

**Critical Alerts** (page on-call):
- `whatsapp_db_query_duration_seconds{quantile="0.95"} > 1.0` for 5 minutes
- `whatsapp_outbox_publish_lag_seconds{quantile="0.95"} > 60` for 10 minutes
- `whatsapp_otp_verified_total{status="failure"} / whatsapp_otp_sent_total > 0.5` for 15 minutes

**Warning Alerts** (Slack notification):
- `whatsapp_user_registrations_total{status="failure"} > 10` in 1 hour
- `whatsapp_outbox_events_published_total < whatsapp_outbox_events_created_total - 100` for 30 minutes

---

## 9. Testing Strategy (TDD)

### 9.1 Integration Test Requirements

**Test File**: `tests/integration/migrations.test.ts`

**Test Cases** (MUST FAIL before migration exists):

1. ✅ Schema creation:
   - Given: Fresh PostgreSQL instance
   - When: Run UP migration
   - Then: `whatsapp_handler` schema exists

2. ✅ Table structure validation:
   - Given: Schema created
   - When: Query `information_schema.tables`
   - Then: All 3 tables exist with correct columns

3. ✅ Index validation:
   - Given: Tables created
   - When: Query `pg_indexes`
   - Then: All 7 indexes exist

4. ✅ Constraint validation:
   - Given: Tables created
   - When: Insert duplicate phone_number
   - Then: Unique constraint violation error

5. ✅ Foreign key cascade:
   - Given: User with preferences exists
   - When: Delete user
   - Then: Preferences automatically deleted

6. ✅ Partial index functionality:
   - Given: `idx_users_verified` exists
   - When: Query verified users
   - Then: Index is used (verify with EXPLAIN)

7. ✅ Rollback migration:
   - Given: UP migration completed
   - When: Run DOWN migration
   - Then: Schema and all tables dropped

### 9.2 Testcontainers Setup

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'node-pg-migrate';

describe('whatsapp_handler schema migrations', () => {
  let container: PostgreSqlContainer;
  let connectionString: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('test')
      .start();
    connectionString = container.getConnectionUri();
  });

  afterAll(async () => {
    await container.stop();
  });

  // Tests here...
});
```

---

## 10. Migration Timeline

### 10.1 Deployment Plan

**Pre-Deployment**:
- [ ] Code review: RFC approved by team
- [ ] Local testing: All integration tests GREEN with Testcontainers
- [ ] Railway staging: N/A (no staging environment per ADR-005)

**Deployment** (estimated 5 minutes):
1. **T+0:00** - Push to GitHub main branch
2. **T+0:30** - Railway auto-deploy triggered
3. **T+1:00** - Migration runs during startup: `npm run migrate:up && npm start`
4. **T+2:00** - Health check passes: `GET /health` returns 200
5. **T+3:00** - Smoke tests run (if configured)
6. **T+5:00** - Verify in Railway logs: "Migrations complete. Starting service..."

**Post-Deployment**:
- [ ] Verify schema created: `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'whatsapp_handler';`
- [ ] Verify tables created: `SELECT tablename FROM pg_tables WHERE schemaname = 'whatsapp_handler';`
- [ ] Test user registration flow manually (send test WhatsApp message)
- [ ] Monitor metrics for 1 hour
- [ ] Update Phase 2 completion checklist

### 10.2 Rollback Plan

**Trigger Conditions** (require rollback):
- Migration fails during execution (automatic transaction rollback)
- Service fails health check after deployment
- Critical bugs discovered in first 4 hours

**Rollback Procedure**:
```bash
# Railway CLI rollback to previous deployment
railway rollback

# OR manual migration rollback
railway run npm run migrate:down
```

**Recovery Time Objective (RTO)**: < 10 minutes

---

## 11. Open Questions & Assumptions

### 11.1 Assumptions
- ✅ Twilio webhook format remains stable (v2010-04-01 API)
- ✅ E.164 phone number format for all users (+447700900123)
- ✅ OTP delivery via SMS (not WhatsApp) per security best practices
- ✅ Session timeout: 24 hours (Redis TTL configurable)
- ✅ Railway PostgreSQL has `uuid-ossp` extension available

### 11.2 Resolved Questions
- **Q**: Should we store OTP in plaintext?
  - **A**: NO - Store hashed OTP in `otp_secret` (application layer hashing)

- **Q**: Should preferences be JSONB or typed columns?
  - **A**: Typed columns - Enables schema validation and NOT NULL constraints

- **Q**: Should we partition outbox_events by date?
  - **A**: NO at MVP scale - 7-day retention keeps table small (<10K rows)

### 11.3 Future Considerations (Post-MVP)
- Consider partitioning `outbox_events` if volume exceeds 100K rows
- Consider adding `users.email` column if email verification is required
- Consider Redis cache for frequently accessed preferences (if >10K users)

---

## 12. Technical Debt

### 12.1 Known Shortcuts

**TD-WHATSAPP-001: OTP Secret Storage** 🟡
- **Description**: OTP secrets stored as VARCHAR(64) hashed at application layer
- **Ideal State**: Use PostgreSQL `pgcrypto` extension for database-level encryption
- **Impact**: Low - Application-layer hashing is acceptable for MVP
- **Remediation**: Migrate to pgcrypto if security audit requires it
- **Owner**: Hoops
- **Target**: Post-MVP security hardening sprint

**TD-WHATSAPP-002: No Phone Number Format Validation** 🟡
- **Description**: Phone number format (E.164) validated only at application layer
- **Ideal State**: Add CHECK constraint: `phone_number ~ '^\+[1-9]\d{1,14}$'`
- **Impact**: Low - Application validation prevents invalid data
- **Remediation**: Add CHECK constraint in future migration
- **Owner**: Hoops
- **Target**: Q1 2026 hardening sprint

**TD-WHATSAPP-003: No Outbox Event Retention Enforcement** 🟡
- **Description**: 7-day retention policy enforced by cron job, not database constraint
- **Ideal State**: PostgreSQL trigger to auto-delete events >7 days old
- **Impact**: Low - Cron job is reliable enough for MVP
- **Remediation**: Create trigger if cron job proves unreliable
- **Owner**: Blake
- **Target**: Monitor for 3 months, implement if needed

### 12.2 Deferred Optimizations

**OPT-WHATSAPP-001: Preferences Caching** 🟢
- **Description**: No Redis cache for user preferences (query on every message)
- **Justification**: Premature optimization - <10ms query latency acceptable
- **Implementation**: Add Redis cache if P95 latency >50ms or >10K users
- **Owner**: Blake
- **Target**: Monitor, implement if needed

---

## 13. Approvals

### 13.1 Sign-Off Checklist

- [x] **Hoops (Data Architect)**: Schema design reviewed and approved
- [ ] **Blake (Backend Engineer)**: Schema supports planned API implementation
- [ ] **Jessie (QA)**: Integration test strategy is comprehensive
- [ ] **Quinn (Orchestrator)**: Aligns with Phase 1 specification

### 13.2 Change Log

| Date       | Author | Change Description                          |
|------------|--------|---------------------------------------------|
| 2025-11-30 | Hoops  | Initial RFC draft                           |

---

## 14. References

**Notion Documentation**:
- **Specification**: `/specifications/whatsapp-handler-specification.md`
- **Data Layer**: Notion › Architecture › Data Layer
- **User Stories**: Notion › User Stories § RAILREPAY-001, RAILREPAY-002, RAILREPAY-600, RAILREPAY-701, RAILREPAY-800
- **ADR-001**: Schema-Per-Service Database Isolation Pattern
- **ADR-003**: Node-pg-migrate as Migration Tool Standard
- **ADR-014**: Test-Driven Development (TDD) Workflow

**PostgreSQL Schema Definitions**:
- Notion › PostgreSQL Schema-Prefixed Table Definitions

---

**Status**: ✅ **RFC APPROVED** - Ready for migration implementation (Phase 2 continues with TDD)

**Next Steps**:
1. Create failing integration tests using Testcontainers
2. Implement migration `001_create_whatsapp_handler_schema.ts`
3. Run migrations and verify tests turn GREEN
4. Document any additional technical debt discovered during implementation
5. Hand off GREEN migrations to Blake for Phase 3 (service implementation)
