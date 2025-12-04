# Technical Debt Register - whatsapp-handler Service

**Service**: whatsapp-handler
**Last Updated**: 2025-11-30
**Owner**: Hoops (Data Architect)

---

## How to Use This Register

This register tracks technical debt for the whatsapp-handler service per Standard Operating Procedures (SOPs). Each item must include:
- **Description**: What shortcut was taken
- **Business Context**: Why this matters
- **Impact**: Risk level (LOW/MEDIUM/HIGH)
- **Recommended Fix**: How to remediate
- **Owner**: Who is responsible
- **Sprint Target**: When to address
- **Status**: Current state

**Status Indicators**:
- 🔴 BLOCKING: Must be resolved before next phase
- 🟡 DEFERRED: Acceptable for MVP, address later
- 🟢 FUTURE: Enhancement, not technical debt

---

## Active Technical Debt

### TD-WHATSAPP-V2-005: v1.0 Code Still Exists (NOT MATCHING v2.0 Schema) 🔴

**Category**: Schema Mismatch
**Severity**: HIGH
**Created**: 2025-11-30 (Phase 3 - Blake)

**Description**:
The existing codebase has v1.0 schema implementations (user.repository.ts, types.ts) that do NOT match the v2.0 simplified schema documented in RFC-whatsapp-handler-schema-v2.md. The v1.0 code references 14 columns in the users table, but the actual database migration creates only 5 columns.

**Business Context**:
- Migration 001 creates v2.0 schema (5 columns: id, phone_number, verified_at, created_at, updated_at)
- Existing code references v1.0 schema (14 columns including otp_secret, display_name, terms_accepted_at, etc.)
- This mismatch will cause runtime errors if v1.0 code is used

**Files Affected**:
- ❌ src/db/types.ts (v1.0 - 14 column User interface)
- ❌ src/db/repositories/user.repository.ts (v1.0 - queries non-existent columns)
- ✅ src/db/types.v2.ts (v2.0 - correct 5 column interface) **CREATED**
- ✅ src/db/repositories/user.repository.v2.ts (v2.0 - correct queries) **CREATED**

**Impact**: HIGH
- V1.0 code will fail at runtime with "column does not exist" errors
- Integration tests will fail if v1.0 code is used
- V2.0 code (newly created) passes all unit tests (13/13 GREEN)

**Recommended Fix**:
```bash
# Replace v1.0 files with v2.0 versions
mv src/db/types.v2.ts src/db/types.ts
mv src/db/repositories/user.repository.v2.ts src/db/repositories/user.repository.ts

# Update all imports throughout codebase to use v2.0 schema
# Update tests to match v2.0 schema
```

**Owner**: Blake (Backend Engineer - Phase 3)
**Sprint Target**: Before Phase 3 completion
**Status**: 🔴 BLOCKING - V1.0 code must be replaced with V2.0 code

**Remediation Estimate**: 2 hours (replace files, update imports, run tests)

---

### TD-WHATSAPP-V2-001: No Phone Number Format Validation 🟡

**Category**: Data Integrity
**Severity**: LOW
**Created**: 2025-11-30 (Phase 2)

**Description**:
Phone numbers are validated for E.164 format only at the application layer. The database does not enforce this constraint.

**Business Context**:
- Phone numbers must be in E.164 format (+447700900123) for Twilio integration
- Invalid phone numbers will cause Twilio API errors
- Application validation is reliable, but DB constraint adds defense-in-depth

**Impact**: LOW
- Application validation prevents invalid data from being inserted
- Risk: If application validation is bypassed (SQL injection, direct DB access), invalid data could be stored

**Recommended Fix**:
```sql
ALTER TABLE whatsapp_handler.users
ADD CONSTRAINT users_phone_number_format_check
CHECK (phone_number ~ '^\+[1-9]\d{1,14}$');
```

**Owner**: Hoops (Data Architect)
**Sprint Target**: Q1 2026 hardening sprint
**Status**: DEFERRED (acceptable for MVP)

**Remediation Estimate**: 1 hour (add constraint + test)

---

### TD-WHATSAPP-V2-002: Preference Value Not Typed 🟡

**Category**: Schema Design
**Severity**: LOW
**Created**: 2025-11-30 (Phase 2)

**Description**:
`user_preferences.preference_value` is TEXT, allowing any string. No database-level validation for JSON values.

**Business Context**:
- Some preferences contain JSON (e.g., notification settings)
- Application layer validates preference values before insertion
- Key-value store design chosen for flexibility (add preferences without ALTER TABLE)

**Impact**: LOW
- Application validation prevents invalid JSON from being stored
- Risk: Schema evolution may be harder if values are not consistently typed

**Recommended Fix** (Option 1 - JSONB):
```sql
ALTER TABLE whatsapp_handler.user_preferences
ALTER COLUMN preference_value TYPE JSONB USING preference_value::JSONB;
```

**Recommended Fix** (Option 2 - Typed Columns):
```sql
-- Migrate to typed preference columns if schema stabilizes
ALTER TABLE whatsapp_handler.user_preferences ADD COLUMN notification_enabled BOOLEAN;
ALTER TABLE whatsapp_handler.user_preferences ADD COLUMN language VARCHAR(10);
-- etc.
```

**Owner**: Blake (Backend Engineer)
**Sprint Target**: Monitor for 3 months, implement if needed
**Status**: DEFERRED (MVP simplicity, key-value store is intentional)

**Remediation Estimate**: 4 hours (migration + application layer refactor)

---

### TD-WHATSAPP-V2-003: No Event Retention Enforcement 🟡

**Category**: Operational
**Severity**: LOW
**Created**: 2025-11-30 (Phase 2)

**Description**:
7-day retention policy for `outbox_events` is enforced by cron job, not database trigger.

**Business Context**:
- outbox_events should auto-delete after `published_at` + 7 days
- Cron job is reliable at MVP scale
- Database trigger would provide stronger guarantee

**Impact**: LOW
- Cron job is sufficient for MVP
- Risk: If cron job fails, table bloat could occur over time

**Recommended Fix**:
```sql
-- PostgreSQL trigger to auto-delete events >7 days old
CREATE OR REPLACE FUNCTION whatsapp_handler.cleanup_old_events()
RETURNS trigger AS $$
BEGIN
  DELETE FROM whatsapp_handler.outbox_events
  WHERE published_at IS NOT NULL
    AND published_at < NOW() - INTERVAL '7 days';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cleanup_old_events
AFTER INSERT ON whatsapp_handler.outbox_events
EXECUTE FUNCTION whatsapp_handler.cleanup_old_events();
```

**Owner**: Blake (Backend Engineer)
**Sprint Target**: Monitor for 3 months, implement if needed
**Status**: DEFERRED (cron job acceptable for MVP)

**Remediation Estimate**: 2 hours (trigger + test)

---

### TD-WHATSAPP-V2-004: Integration Tests Blocked by Docker 🔴

**Category**: Testing
**Severity**: MEDIUM
**Created**: 2025-11-30 (Phase 2)

**Description**:
Testcontainers integration tests cannot run in WSL environment without Docker. Migration syntax verified manually, but database constraints not fully tested.

**Business Context**:
- Full integration tests required before production deployment
- Manual verification confirms migration syntax is correct
- Database constraint enforcement (unique, foreign key, check) not tested

**Impact**: MEDIUM
- Migration syntax verified (no SQL errors expected)
- Risk: Constraint edge cases (e.g., cascade delete, check violations) not tested

**Recommended Fix**:
```bash
# Blake must run integration tests in Docker-enabled environment
npm run test:integration
```

**Expected Result**: All 11 tests GREEN

**Owner**: Blake (Backend Engineer - Phase 3)
**Sprint Target**: Before Phase 3 completion
**Status**: ⚠️ ESCALATED - Docker not available in WSL environment (2025-11-30 14:12 UTC)

**Blake's Note** (2025-11-30):
- Confirmed Docker unavailable in WSL environment ("Could not find a working container runtime strategy")
- Integration tests WILL run in CI/CD pipeline (Railway has Docker)
- Proceeding with unit tests (100% mockable, no Docker needed)
- Will verify integration tests pass in CI/CD during Moykle Phase 5
- BLOCKING condition: Integration tests must pass in CI before production deployment

**Remediation Estimate**: 30 minutes (run tests in Docker-enabled CI environment)

---

## Future Enhancements (Not Technical Debt)

### FUTURE-WHATSAPP-001: Add correlation_id for Distributed Tracing 🟢

**Category**: Observability
**Created**: 2025-11-30 (Phase 2)

**Description**:
`outbox_events` table does not include `correlation_id` for distributed tracing (deferred from v1.0 schema).

**Business Context**:
- Distributed tracing enables request flow tracking across services
- Not needed at MVP scale (single service deployment)
- Add when observability platform (Datadog/New Relic) is deployed

**Implementation**:
```sql
ALTER TABLE whatsapp_handler.outbox_events
ADD COLUMN correlation_id VARCHAR(64);

CREATE INDEX idx_outbox_events_correlation
ON whatsapp_handler.outbox_events(correlation_id);
```

**Owner**: Moykle (DevOps)
**Target**: When observability platform deployed (post-MVP)

---

### FUTURE-WHATSAPP-002: Add event_version for Schema Evolution 🟢

**Category**: Event Versioning
**Created**: 2025-11-30 (Phase 2)

**Description**:
`outbox_events` table does not include `event_version` for event schema evolution (deferred from v1.0 schema).

**Business Context**:
- Event versioning enables backward-compatible schema changes
- Not needed at MVP (only 1 event version exists)
- Add when first breaking event schema change occurs

**Implementation**:
```sql
ALTER TABLE whatsapp_handler.outbox_events
ADD COLUMN event_version VARCHAR(10) NOT NULL DEFAULT '1.0';
```

**Owner**: Blake (Backend Engineer)
**Target**: When first breaking event schema change occurs (post-MVP)

---

### FUTURE-WHATSAPP-003: Consider GDPR Soft-Delete Pattern 🟢

**Category**: Compliance
**Created**: 2025-11-30 (Phase 2)

**Description**:
Current design uses hard DELETE for GDPR compliance (no `blocked_at`, `block_reason` columns from v1.0).

**Business Context**:
- GDPR right to erasure currently implemented via hard DELETE
- Audit trail is lost after deletion
- Soft-delete pattern would preserve audit trail (anonymize PII instead of DELETE)

**Implementation**:
```sql
ALTER TABLE whatsapp_handler.users
ADD COLUMN blocked_at TIMESTAMPTZ,
ADD COLUMN block_reason TEXT;

-- GDPR erasure: Anonymize instead of DELETE
UPDATE whatsapp_handler.users
SET
  phone_number = 'ANONYMIZED_' || id,
  blocked_at = NOW(),
  block_reason = 'GDPR_ERASURE_REQUEST'
WHERE id = 'user-uuid';
```

**Owner**: Hoops (Data Architect)
**Target**: If legal/compliance requires audit trail (post-MVP)

---

## Closed Technical Debt

None yet.

---

## Summary Metrics

**Total Active Debt Items**: 4
- 🔴 BLOCKING: 1 (TD-WHATSAPP-V2-004)
- 🟡 DEFERRED: 3 (TD-WHATSAPP-V2-001, 002, 003)
- 🟢 FUTURE: 3 (FUTURE-WHATSAPP-001, 002, 003)

**Total Remediation Estimate**: 7.5 hours
- Phase 3 (Blake): 0.5 hours (TD-WHATSAPP-V2-004)
- Q1 2026 (Hoops/Blake): 7 hours (TD-WHATSAPP-V2-001, 002, 003)

**Risk Assessment**: LOW
- 1 BLOCKING item must be resolved before Phase 3 completion
- 3 DEFERRED items are acceptable for MVP
- 3 FUTURE items are enhancements, not debt

---

## Review Schedule

This register should be reviewed:
- **Weekly**: During sprint planning (check for new debt)
- **Monthly**: Review deferred items (re-prioritize if needed)
- **Quarterly**: Assess future enhancements (schedule if business case exists)

**Next Review**: 2025-12-07 (Sprint planning)

---

**Last Updated By**: Hoops (Data Architect)
**Last Updated**: 2025-11-30
**Phase**: 2 (Data Layer) COMPLETE
