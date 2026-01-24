# RFC: whatsapp-handler Schema v2.0 (Simplified)

**Author**: Hoops (Data Architect)
**Date**: 2025-11-30
**Status**: Approved for Implementation
**Phase**: 2 (Data Layer)
**Version**: 2.0 (REPLACES v1.0)
**Related Specification**: `/specifications/whatsapp-handler-specification.md`

---

## Executive Summary

This RFC documents the **v2.0 simplified schema** for the `whatsapp-handler` service, replacing the initial v1.0 design. The v2.0 schema eliminates unnecessary complexity by leveraging external services (Twilio Verify API) and architectural decisions (Redis FSM, claim-dispatcher service ownership).

**Schema Name**: `whatsapp_handler` (per ADR-001 schema-per-service pattern)

**Tables**: 3 core tables (simplified from v1.0)
- `users` - Minimal user identity (5 columns only)
- `user_preferences` - Key-value store (flexible schema)
- `outbox_events` - Simplified event publishing (no correlation_id, metadata, event_version)

**User Story References**:
- RAILREPAY-001: First-time user registration via WhatsApp
- RAILREPAY-002: Returning user authentication
- RAILREPAY-100: Journey selection and validation
- RAILREPAY-600: WhatsApp webhook processing and security

---

## 1. Business Context

### 1.1 Why v2.0? (Simplification Rationale)

**From Quinn's Phase 1 Specification**:
> "Twilio Verify API handles OTP generation, delivery, and verification. The whatsapp-handler service only needs to store verification timestamps, not OTP secrets."

**From whatsapp-handler-specification.md § External Dependencies**:
> "Twilio Verify API: Phone number verification (OTP delivery and validation)"
> "timetable-loader API: Real-time journey data retrieval"

**From Architecture § Data Layer**:
> "Redis: Ephemeral FSM state with 24-hour TTL for conversation management"

These architectural decisions eliminate the need for v1.0's complex schema fields:
- **OTP secrets**: Managed entirely by Twilio Verify API (external)
- **Activity tracking**: Managed by Redis FSM with 24hr TTL (ephemeral)
- **Terms acceptance**: Owned by claim-dispatcher service (domain boundary)
- **Display name**: Not required for phone-based authentication

### 1.2 Service Responsibilities (Per Specification)

**whatsapp-handler ONLY manages**:
1. User phone number registration
2. Verification status (timestamp from Twilio Verify callback)
3. User preferences (flexible key-value store)
4. Event publishing to downstream services

**whatsapp-handler DOES NOT manage** (delegated to other services):
- Journey data → `journey-matcher` service
- Claim data → `claim-dispatcher` service
- OTP generation/validation → Twilio Verify API
- Conversation state → Redis FSM (24hr TTL)

---

## 2. v1.0 vs v2.0 Schema Comparison

### 2.1 Table: users

| Field (v1.0) | Field (v2.0) | Rationale for Change |
|--------------|--------------|----------------------|
| `id` | `id` | ✅ No change (UUID primary key) |
| `phone_number` | `phone_number` | ✅ No change (E.164 format) |
| `display_name` | ❌ REMOVED | Not needed for phone-based auth |
| `verified_at` | `verified_at` | ✅ No change (Twilio Verify timestamp) |
| `registered_at` | ❌ REMOVED | Use `created_at` instead |
| `last_active_at` | ❌ REMOVED | Redis FSM tracks activity (24hr TTL) |
| `otp_secret` | ❌ REMOVED | Twilio Verify manages OTP lifecycle |
| `otp_verified_at` | ❌ REMOVED | Merged into `verified_at` |
| `terms_accepted_at` | ❌ REMOVED | Moved to claim-dispatcher schema |
| `terms_version` | ❌ REMOVED | Moved to claim-dispatcher schema |
| `blocked_at` | ❌ REMOVED | GDPR deletion via API (not soft-delete) |
| `block_reason` | ❌ REMOVED | GDPR deletion via API |
| `created_at` | `created_at` | ✅ No change (audit trail) |
| `updated_at` | `updated_at` | ✅ No change (audit trail) |

**v2.0 users table**: 5 columns (down from 14 in v1.0)

```sql
CREATE TABLE whatsapp_handler.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(20) NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_phone_number_unique UNIQUE (phone_number)
);
```

### 2.2 Table: user_preferences

| Design (v1.0) | Design (v2.0) | Rationale for Change |
|---------------|---------------|----------------------|
| **Typed columns**: `notification_enabled BOOLEAN`, `language VARCHAR(10)`, `timezone VARCHAR(50)`, etc. | **Key-value store**: `preference_key VARCHAR(100)`, `preference_value TEXT` | Flexibility: Add new preferences without ALTER TABLE |
| **One-to-one relationship** (enforced by unique index on `user_id`) | **One-to-many relationship** (user can have multiple preferences) | MVP simplicity: No need for ALTER TABLE migrations |
| **7 preference columns** | **2 flexible columns** | Easier to extend in Phase 3 |

**v2.0 user_preferences table**:
```sql
CREATE TABLE whatsapp_handler.user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES whatsapp_handler.users(id) ON DELETE CASCADE,
    preference_key VARCHAR(100) NOT NULL,
    preference_value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_preferences_user_key_unique UNIQUE (user_id, preference_key)
);
```

**Example usage**:
```sql
-- Insert preferences
INSERT INTO user_preferences (user_id, preference_key, preference_value)
VALUES
  ('user-uuid', 'language', 'en-GB'),
  ('user-uuid', 'timezone', 'Europe/London'),
  ('user-uuid', 'notification_enabled', 'true'),
  ('user-uuid', 'delay_threshold_minutes', '15');

-- Query preferences
SELECT preference_key, preference_value
FROM user_preferences
WHERE user_id = 'user-uuid';
```

### 2.3 Table: outbox_events

| Field (v1.0) | Field (v2.0) | Rationale for Change |
|--------------|--------------|----------------------|
| `id` | `id` | ✅ No change |
| `aggregate_id` | `aggregate_id` | ✅ No change |
| `aggregate_type` | `aggregate_type` | ✅ No change |
| `event_type` | `event_type` | ✅ No change |
| `event_version` | ❌ REMOVED | YAGNI - Add when multiple versions exist |
| `payload` | `payload` | ✅ No change (JSONB) |
| `metadata` | ❌ REMOVED | YAGNI - Not needed at MVP scale |
| `correlation_id` | ❌ REMOVED | YAGNI - Add when distributed tracing implemented |
| `created_at` | `created_at` | ✅ No change |
| `published_at` | `published_at` | ✅ No change |

**v2.0 outbox_events table**: 7 columns (down from 10 in v1.0)

```sql
CREATE TABLE whatsapp_handler.outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id UUID NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT outbox_events_aggregate_check CHECK (aggregate_type IN ('user', 'journey', 'claim'))
);
```

---

## 3. Architectural Decisions Impact

### 3.1 Twilio Verify API Integration

**Decision** (from whatsapp-handler-specification.md):
> "Use Twilio Verify API for OTP delivery and validation. The service receives verification callbacks at `/webhooks/twilio/verify/status`."

**Impact on Schema**:
- ❌ Remove `otp_secret` (Twilio manages OTP lifecycle)
- ❌ Remove `otp_verified_at` (merged into `verified_at`)
- ✅ Keep `verified_at` (set from Twilio callback)

**Implementation**:
1. User sends WhatsApp message with phone number
2. Service calls `POST /v2/Services/{ServiceSid}/Verifications` (Twilio Verify API)
3. User receives OTP via SMS
4. User sends OTP code via WhatsApp
5. Service calls `POST /v2/Services/{ServiceSid}/VerificationCheck` (Twilio Verify API)
6. If valid, set `users.verified_at = NOW()`

### 3.2 Redis FSM for Conversation State

**Decision** (from whatsapp-handler-specification.md):
> "FSM state stored in Redis with 24-hour TTL. State includes: current_step, context, last_message_at."

**Impact on Schema**:
- ❌ Remove `last_active_at` (Redis FSM tracks activity)
- ❌ Remove `registered_at` (use `created_at` instead)
- ✅ Conversation state is ephemeral (not persisted in PostgreSQL)

**Redis FSM Example**:
```redis
# Key: fsm:user:{phone_number}
# Value: {"current_step": "AWAITING_OTP", "context": {...}, "last_message_at": "2025-11-30T12:00:00Z"}
# TTL: 86400 seconds (24 hours)
```

### 3.3 claim-dispatcher Owns Terms Acceptance

**Decision** (from Architecture § Service Boundaries):
> "claim-dispatcher service owns claim lifecycle, including terms acceptance tracking."

**Impact on Schema**:
- ❌ Remove `terms_accepted_at` (moved to claim_dispatcher.claims table)
- ❌ Remove `terms_version` (moved to claim_dispatcher.claims table)
- ✅ whatsapp-handler only registers users, does not track claims

**Cross-Service Reference**:
```javascript
// whatsapp-handler publishes event
await outboxRepository.createEvent({
  aggregate_type: 'user',
  event_type: 'user.verified',
  payload: { user_id: '...', phone_number: '+44...' }
});

// claim-dispatcher listens to Pub/Sub and creates claim
await claimRepository.create({
  user_id: '...',
  terms_accepted_at: NOW(),
  terms_version: '1.0'
});
```

### 3.4 timetable-loader API for Journey Data

**Decision** (from whatsapp-handler-specification.md):
> "Fetch real-time journey data from timetable-loader API. Do not cache in PostgreSQL."

**Impact on Schema**:
- ✅ No journey-related tables in whatsapp_handler schema
- ✅ Journey selection stored in Redis FSM (ephemeral)
- ✅ journey-matcher service owns journey data

---

## 4. Migration Strategy (Clean Replacement)

### 4.1 Human Decision: Replace Migration 001

**Context**:
- Migration 001 has NOT been run anywhere (fresh service)
- No data to preserve
- No downstream dependencies yet

**Decision**: Replace migration 001 entirely with v2.0 schema

**Implementation**:
```bash
# OLD: migrations/001_create_whatsapp_handler_schema.ts (v1.0)
# NEW: migrations/001_create_whatsapp_handler_schema.ts (v2.0)
```

### 4.2 Rollback Safety

**Rollback is safe because**:
1. No data exists (new service)
2. No dependent services (first deployment)
3. Idempotent UP migration allows retry
4. CASCADE drops handle foreign keys

**Rollback Command**:
```bash
npm run migrate:down
```

---

## 5. Index Strategy (v2.0)

### 5.1 users Table Indexes

```sql
-- Primary lookup: phone number (every webhook)
CREATE INDEX idx_users_phone ON whatsapp_handler.users(phone_number);
-- Justification: Unique constraint already provides index, but explicit for clarity
-- Expected P95 < 10ms

-- Partial index: verified users only
CREATE INDEX idx_users_verified ON whatsapp_handler.users(verified_at)
    WHERE verified_at IS NOT NULL;
-- Justification: Analytics queries ("How many verified users?")
-- Saves space on unverified users
-- Expected P95 < 50ms
```

### 5.2 user_preferences Table Indexes

```sql
-- Primary lookup: get all preferences for user
CREATE INDEX idx_user_preferences_user ON whatsapp_handler.user_preferences(user_id);
-- Justification: Fetch all preferences on every message
-- Expected P95 < 10ms
```

### 5.3 outbox_events Table Indexes

```sql
-- Partial index: unpublished events (outbox-relay polling)
CREATE INDEX idx_outbox_events_published ON whatsapp_handler.outbox_events(created_at)
    WHERE published_at IS NULL;
-- Justification: outbox-relay queries "next 100 unpublished events"
-- Expected P95 < 50ms

-- Full index: event history (debugging)
CREATE INDEX idx_outbox_events_created ON whatsapp_handler.outbox_events(created_at);
-- Justification: Retention cleanup queries (delete events >7 days old)
-- Expected P95 < 100ms
```

---

## 6. Performance Analysis (v2.0)

### 6.1 Expected Query Patterns

**Hot Path (P95 < 100ms SLO)**:

1. **User lookup by phone number** (every webhook):
```sql
SELECT id, verified_at FROM whatsapp_handler.users WHERE phone_number = '+447700900123';
```
- Expected: P95 < 10ms (unique index)
- Volume: ~1000 requests/hour

2. **User preferences retrieval**:
```sql
SELECT preference_key, preference_value FROM whatsapp_handler.user_preferences WHERE user_id = 'uuid';
```
- Expected: P95 < 10ms (btree index on user_id)
- Volume: ~500 requests/hour

3. **Unpublished events polling**:
```sql
SELECT * FROM whatsapp_handler.outbox_events WHERE published_at IS NULL ORDER BY created_at ASC LIMIT 100;
```
- Expected: P95 < 50ms (partial index)
- Volume: Poll every 5 seconds

**Cold Path (P95 < 1000ms acceptable)**:

4. **Event retention cleanup** (daily batch):
```sql
DELETE FROM whatsapp_handler.outbox_events WHERE published_at IS NOT NULL AND created_at < NOW() - INTERVAL '7 days';
```
- Expected: P95 < 500ms (index on created_at)
- Volume: 1 query/day

### 6.2 Storage Estimates

**users table**:
- Row size: ~120 bytes (UUID + VARCHAR(20) + 3 timestamps)
- Expected rows: 10,000 users (1 year MVP)
- Storage: ~1.2 MB + indexes ~1.5 MB = **~3 MB total**

**user_preferences table**:
- Row size: ~100 bytes per preference
- Expected rows: 40,000 (4 preferences × 10,000 users)
- Storage: ~4 MB + indexes ~2 MB = **~6 MB total**

**outbox_events table**:
- Row size: ~400 bytes (JSONB payload)
- Expected rows: 3,500 (500/day × 7-day retention)
- Storage: ~1.4 MB + indexes ~1 MB = **~2.5 MB total**

**Total Schema Storage**: ~12 MB (down from ~130 MB in v1.0)

---

## 7. Testing Strategy (TDD)

### 7.1 Integration Test Requirements

**Test File**: `tests/integration/migrations.test.ts`

**Test Cases** (MUST PASS with v2.0 schema):

1. ✅ Schema creation
2. ✅ users table: 5 columns only (no otp_secret, display_name, etc.)
3. ✅ user_preferences table: key-value store (preference_key, preference_value)
4. ✅ outbox_events table: 7 columns only (no correlation_id, metadata, event_version)
5. ✅ Unique constraint: phone_number
6. ✅ Unique constraint: user_id + preference_key
7. ✅ Cascade delete: user_preferences when user deleted
8. ✅ CHECK constraint: aggregate_type IN ('user', 'journey', 'claim')
9. ✅ Partial index usage: idx_users_verified, idx_outbox_events_published
10. ✅ Rollback: DROP schema and all tables

### 7.2 Testcontainers Setup

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';

describe('whatsapp_handler schema migrations v2.0', () => {
  let container: PostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  // Tests verify v2.0 schema...
});
```

---

## 8. Technical Debt (v2.0)

### 8.1 Known Shortcuts

**TD-WHATSAPP-V2-001: No Phone Number Format Validation** 🟡
- **Description**: E.164 format validated only at application layer
- **Ideal State**: Add CHECK constraint: `phone_number ~ '^\+[1-9]\d{1,14}$'`
- **Impact**: Low - Application validation prevents invalid data
- **Remediation**: Add CHECK constraint in future migration
- **Owner**: Hoops
- **Target**: Q1 2026 hardening sprint

**TD-WHATSAPP-V2-002: Preference Value Not Typed** 🟡
- **Description**: `preference_value TEXT` allows any string (no JSON validation)
- **Ideal State**: Use JSONB for structured values OR typed columns
- **Impact**: Low - Application layer validates preference values
- **Remediation**: Migrate to typed columns if schema becomes stable
- **Owner**: Blake
- **Target**: Monitor for 3 months, implement if needed

**TD-WHATSAPP-V2-003: No Event Retention Enforcement** 🟡
- **Description**: 7-day retention enforced by cron job, not database trigger
- **Ideal State**: PostgreSQL trigger to auto-delete events >7 days old
- **Impact**: Low - Cron job is reliable at MVP scale
- **Remediation**: Create trigger if cron job proves unreliable
- **Owner**: Blake
- **Target**: Monitor for 3 months, implement if needed

### 8.2 Future Considerations (Post-MVP)

**FUTURE-WHATSAPP-001: Add correlation_id for Distributed Tracing** 🟢
- **Description**: No correlation_id in outbox_events (deferred from v1.0)
- **Implementation**: Add column when distributed tracing is implemented
- **Owner**: Moykle (DevOps)
- **Target**: When observability platform (Datadog/New Relic) is deployed

**FUTURE-WHATSAPP-002: Add event_version for Schema Evolution** 🟢
- **Description**: No event_version in outbox_events (deferred from v1.0)
- **Implementation**: Add column when multiple event versions exist
- **Owner**: Blake
- **Target**: When first breaking event schema change occurs

**FUTURE-WHATSAPP-003: Consider GDPR Soft-Delete Pattern** 🟢
- **Description**: Hard DELETE for GDPR (no blocked_at, block_reason)
- **Implementation**: Add soft-delete columns if audit requirements change
- **Owner**: Hoops
- **Target**: If legal/compliance requires audit trail

---

## 9. Approvals

### 9.1 Sign-Off Checklist

- [x] **Hoops (Data Architect)**: v2.0 schema design reviewed and approved
- [x] **Quinn (Orchestrator)**: Aligns with Phase 1 specification
- [ ] **Blake (Backend Engineer)**: Schema supports planned API implementation
- [ ] **Jessie (QA)**: Integration test strategy is comprehensive

### 9.2 Change Log

| Date       | Author | Change Description                          |
|------------|--------|---------------------------------------------|
| 2025-11-30 | Hoops  | v2.0 RFC - Simplified schema replacing v1.0 |

---

## 10. References

**Specification**:
- `/specifications/whatsapp-handler-specification.md`

**User Stories**:
- RAILREPAY-001: First-time user registration via WhatsApp
- RAILREPAY-002: Returning user authentication
- RAILREPAY-100: Journey selection and validation
- RAILREPAY-600: WhatsApp webhook processing and security

**ADRs**:
- ADR-001: Schema-Per-Service Database Isolation Pattern
- ADR-003: Node-pg-migrate as Migration Tool Standard
- ADR-014: Test-Driven Development (TDD) Workflow

**Notion Documentation**:
- Architecture › Data Layer
- Architecture › Service Layer § whatsapp-handler
- Project Overview § WhatsApp-First UX

---

**Status**: ✅ **RFC APPROVED** - Ready for implementation (Phase 2)

**Next Steps**:
1. ✅ Migration 001 replaced with v2.0 schema
2. ✅ Integration tests updated to match v2.0
3. ⏳ Run tests and verify GREEN status
4. ⏳ Document technical debt in Notion
5. ⏳ Hand off GREEN migrations to Blake (Phase 3)
