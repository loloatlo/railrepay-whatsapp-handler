# Schema Analysis for Hoops - whatsapp-handler

**Date**: 2025-11-30
**Prepared By**: Quinn (Product Owner & Chief Orchestrator)
**For**: Hoops (Data Architect)
**Purpose**: Detailed schema analysis to guide Phase 2 migration development

---

## Current Schema Status

### Existing State
- **Schema**: whatsapp_handler (MAY NOT EXIST YET - check in Railway PostgreSQL)
- **Tables**: 0 tables currently exist
- **Migrations**: No previous migrations for this service

### What Needs to Be Created
This is a **greenfield schema creation** - Hoops will create the schema and all tables from scratch.

**Note**: If a previous attempt at Phase 2 was made, Hoops should verify the current state of Railway PostgreSQL before proceeding. Run this query to check:

```sql
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name = 'whatsapp_handler';

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'whatsapp_handler';
```

If schema or tables exist, Hoops must ensure migration is idempotent (use IF NOT EXISTS).

---

## Schema Design Based on Architectural Decisions

### Decision Impact Analysis

#### ESCALATION-001: Twilio Verify API (RESOLVED)
**Decision**: Use Twilio Verify API for OTP

**Schema Impact**:
- ✅ **NO custom OTP table** (original specification may have mentioned this - IGNORE IT)
- ✅ **NO otp_code column** in users table
- ✅ **NO otp_attempts column** in users table
- ✅ **NO otp_expires_at column** in users table
- ✅ **KEEP verified_at column** in users table (set after Twilio Verify confirms OTP)

**Rationale**: Twilio Verify API stores OTP codes internally and handles expiry, rate limiting, and fraud detection. We only need to track whether the user has been verified (verified_at).

#### ESCALATION-002: timetable-loader API (RESOLVED)
**Decision**: Station matching via timetable-loader API

**Schema Impact**:
- ✅ **NO station cache table** (no stations, station_aliases, station_crs_codes tables)
- ✅ **NO station-related columns** in any table
- ✅ **NO station-related indexes**

**Rationale**: All station lookups are delegated to timetable-loader service via API. This keeps the schema simple and ensures data freshness.

#### ESCALATION-003: 24-hour session timeout (RESOLVED)
**Decision**: Keep 24-hour session timeout

**Schema Impact**:
- ✅ **NO session_timeout column** in users table
- ✅ **NO session_expires_at column** in users table
- ✅ Session state is stored in **Redis**, NOT PostgreSQL

**Rationale**: Redis TTL handles session expiry (REDIS_CACHE_TTL_SECONDS=86400). PostgreSQL only stores permanent user data (phone_number, verified_at).

---

## Required Tables (FINAL SPECIFICATION)

### Table 1: users

**Purpose**: Store registered WhatsApp users with verification status

**DDL**:
```sql
CREATE TABLE whatsapp_handler.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Indexes**:
```sql
-- B-tree index for fast phone number lookup (most common query)
CREATE INDEX idx_users_phone ON whatsapp_handler.users(phone_number);

-- Partial index for verified users only (reduces index size)
CREATE INDEX idx_users_verified
ON whatsapp_handler.users(verified_at)
WHERE verified_at IS NOT NULL;
```

**Column Details**:
- `id`: UUID v4 primary key (auto-generated)
- `phone_number`: E.164 format (e.g., +447700900123), unique across all users
- `verified_at`: NULL until user completes OTP verification via Twilio Verify, then set to verification timestamp
- `created_at`: Timestamp of first message from user (immutable)
- `updated_at`: Updated on any column change (use trigger or application logic)

**Constraints**:
- `phone_number` UNIQUE: Prevents duplicate registrations
- `phone_number` NOT NULL: Every user must have a phone number
- `verified_at` NULLABLE: User may not have completed OTP yet

**Business Rules**:
- New user: phone_number set, verified_at = NULL
- OTP verified: verified_at set to NOW()
- Returning user: verified_at NOT NULL (skip OTP flow)

**Cross-Service References** (NO FK):
- This table is the SOURCE OF TRUTH for user_id
- journey-matcher validates user_id via GET /api/v1/users/:id (API validation, NO FK)
- payments-service references user_id (NO FK per ADR-001)

**Query Patterns**:
```sql
-- Most common: Lookup user by phone number (every incoming WhatsApp message)
SELECT * FROM whatsapp_handler.users WHERE phone_number = '+447700900123';
-- Expected: Index scan on idx_users_phone, <5ms

-- Check if user is verified (authentication flow)
SELECT id, verified_at FROM whatsapp_handler.users
WHERE phone_number = '+447700900123' AND verified_at IS NOT NULL;
-- Expected: Index scan on idx_users_phone + idx_users_verified, <5ms

-- Update verified_at after OTP confirmation
UPDATE whatsapp_handler.users
SET verified_at = NOW(), updated_at = NOW()
WHERE id = 'uuid';
-- Expected: Primary key lookup, <3ms
```

---

### Table 2: user_preferences

**Purpose**: Store user preferences (language, notification settings, etc.)

**DDL**:
```sql
CREATE TABLE whatsapp_handler.user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES whatsapp_handler.users(id) ON DELETE CASCADE,
  preference_key VARCHAR(50) NOT NULL,
  preference_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, preference_key)
);
```

**Indexes**:
```sql
-- B-tree index for FK join (user_id lookup)
CREATE INDEX idx_user_preferences_user
ON whatsapp_handler.user_preferences(user_id);
```

**Column Details**:
- `id`: UUID v4 primary key
- `user_id`: FK to users(id), CASCADE delete (delete user → delete preferences)
- `preference_key`: Key name (e.g., "language", "notifications_enabled")
- `preference_value`: Value as TEXT (can store JSON string for complex preferences)
- `created_at`: Timestamp of preference creation
- `updated_at`: Timestamp of last preference change

**Constraints**:
- `user_id` NOT NULL: Every preference must belong to a user
- `user_id` FOREIGN KEY to users(id) ON DELETE CASCADE (SAME SCHEMA, FK allowed per ADR-001)
- UNIQUE(user_id, preference_key): Prevent duplicate preference keys per user

**Business Rules**:
- One preference_key per user (e.g., user can have only one "language" preference)
- preference_value can be NULL (preference exists but no value set)
- Deleting a user cascades to delete all their preferences

**Example Data**:
```sql
INSERT INTO whatsapp_handler.user_preferences (user_id, preference_key, preference_value)
VALUES
  ('uuid-1', 'language', 'en'),
  ('uuid-1', 'notifications_enabled', 'true'),
  ('uuid-1', 'timezone', 'Europe/London');
```

**Query Patterns**:
```sql
-- Get all preferences for a user
SELECT preference_key, preference_value
FROM whatsapp_handler.user_preferences
WHERE user_id = 'uuid';
-- Expected: Index scan on idx_user_preferences_user, <10ms

-- Get specific preference
SELECT preference_value
FROM whatsapp_handler.user_preferences
WHERE user_id = 'uuid' AND preference_key = 'language';
-- Expected: Index scan on idx_user_preferences_user + UNIQUE index, <5ms

-- Update preference
UPDATE whatsapp_handler.user_preferences
SET preference_value = 'fr', updated_at = NOW()
WHERE user_id = 'uuid' AND preference_key = 'language';
-- Expected: UNIQUE index lookup, <5ms
```

---

### Table 3: outbox_events

**Purpose**: Transactional outbox pattern for reliable event publishing

**DDL**:
```sql
CREATE TABLE whatsapp_handler.outbox_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_version VARCHAR(10) NOT NULL DEFAULT '1.0',
  payload JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);
```

**Indexes**:
```sql
-- Partial index for unpublished events (outbox-relay worker query)
CREATE INDEX idx_outbox_events_published
ON whatsapp_handler.outbox_events(published_at)
WHERE published_at IS NULL;

-- B-tree index for created_at ordering (FIFO processing)
CREATE INDEX idx_outbox_events_created
ON whatsapp_handler.outbox_events(created_at);
```

**Column Details**:
- `id`: UUID v4 primary key
- `aggregate_id`: UUID reference to users(id) (NO FK - loose coupling)
- `event_type`: Event name (e.g., "user.registered", "user.session.started")
- `event_version`: Semantic versioning for event schema (default "1.0")
- `payload`: Event data as JSONB (e.g., {"phone_number": "+447700900123", "verified_at": "2025-11-30T10:00:00Z"})
- `metadata`: Optional metadata as JSONB (e.g., {"correlation_id": "uuid", "user_agent": "Twilio/1.0"})
- `created_at`: Timestamp of event creation (immutable)
- `published_at`: NULL until event published by outbox-relay worker, then set to publication timestamp

**Constraints**:
- `aggregate_id` NOT NULL: Every event must reference an aggregate (user)
- `event_type` NOT NULL: Every event must have a type
- `payload` NOT NULL: Every event must have data
- `published_at` NULLABLE: Event may not have been published yet

**NO Foreign Key on aggregate_id**:
- aggregate_id is a logical reference to users(id)
- NO FK constraint (outbox pattern requires loose coupling)
- If user is deleted, events remain for audit trail (acceptable orphaned events)

**Business Rules**:
- Events are created in the same transaction as user state changes (ACID)
- outbox-relay worker polls for unpublished events (WHERE published_at IS NULL)
- After publishing to Kafka/message bus, published_at is set to NOW()
- Events are immutable after creation (no UPDATE, only INSERT)

**Event Types**:
- `user.registered`: New user completed OTP verification
- `user.session.started`: Returning user authenticated
- `journey.confirmed`: User confirmed journey details (trigger journey-matcher)

**Example Data**:
```sql
INSERT INTO whatsapp_handler.outbox_events (aggregate_id, event_type, payload, metadata)
VALUES (
  'user-uuid',
  'user.registered',
  '{"phone_number": "+447700900123", "verified_at": "2025-11-30T10:00:00Z"}'::jsonb,
  '{"correlation_id": "correlation-uuid", "source": "whatsapp-handler"}'::jsonb
);
```

**Query Patterns**:
```sql
-- outbox-relay worker: Get unpublished events (most common query)
SELECT id, aggregate_id, event_type, event_version, payload, metadata, created_at
FROM whatsapp_handler.outbox_events
WHERE published_at IS NULL
ORDER BY created_at ASC
LIMIT 100;
-- Expected: Index scan on idx_outbox_events_published, <10ms

-- Mark event as published (after successful Kafka publish)
UPDATE whatsapp_handler.outbox_events
SET published_at = NOW()
WHERE id = 'event-uuid';
-- Expected: Primary key lookup, <3ms

-- Audit: Get all events for a user
SELECT event_type, payload, created_at, published_at
FROM whatsapp_handler.outbox_events
WHERE aggregate_id = 'user-uuid'
ORDER BY created_at DESC;
-- Expected: Sequential scan (no index on aggregate_id - rare query)
```

---

## Schema Change Analysis

### What Changed from Original Specification?

**REMOVED (due to ESCALATION-001: Twilio Verify API)**:
- ❌ Table: otp_codes (or similar) - NOT NEEDED
- ❌ Column: users.otp_code - NOT NEEDED
- ❌ Column: users.otp_attempts - NOT NEEDED
- ❌ Column: users.otp_expires_at - NOT NEEDED
- ❌ Redis key pattern: otp:{phone_number} - NOT NEEDED (updated specification reflects this)

**REMOVED (due to ESCALATION-002: timetable-loader API)**:
- ❌ Table: stations - NOT NEEDED
- ❌ Table: station_aliases - NOT NEEDED
- ❌ Column: any station-related columns - NOT NEEDED

**CONFIRMED (due to ESCALATION-003: 24-hour session)**:
- ✅ NO session_timeout column in users table (timeout is in Redis TTL)
- ✅ users.verified_at remains permanent (never expires)

### What Remains Unchanged?

**KEPT (required for core functionality)**:
- ✅ Table: users (phone_number, verified_at, created_at, updated_at)
- ✅ Table: user_preferences (user_id FK, preference_key, preference_value)
- ✅ Table: outbox_events (aggregate_id, event_type, payload, published_at)
- ✅ Indexes as specified above

---

## Migration Requirements

### Migration File Structure

**Location**: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/migrations/TIMESTAMP_create_whatsapp_handler_schema.ts`

**Template**:
```typescript
/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Step 1: Create schema (idempotent)
  pgm.createSchema('whatsapp_handler', { ifNotExists: true });

  // Step 2: Enable uuid-ossp extension (if not already enabled)
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

  // Step 3: Create users table
  pgm.createTable(
    { schema: 'whatsapp_handler', name: 'users' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('uuid_generate_v4()'),
      },
      phone_number: {
        type: 'varchar(20)',
        notNull: true,
        unique: true,
      },
      verified_at: {
        type: 'timestamptz',
        notNull: false,
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
    },
    { ifNotExists: true }
  );

  // Step 4: Create indexes for users table
  pgm.createIndex(
    { schema: 'whatsapp_handler', name: 'users' },
    'phone_number',
    { name: 'idx_users_phone', ifNotExists: true }
  );

  pgm.createIndex(
    { schema: 'whatsapp_handler', name: 'users' },
    'verified_at',
    {
      name: 'idx_users_verified',
      where: 'verified_at IS NOT NULL',
      ifNotExists: true,
    }
  );

  // Step 5: Create user_preferences table
  pgm.createTable(
    { schema: 'whatsapp_handler', name: 'user_preferences' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('uuid_generate_v4()'),
      },
      user_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'whatsapp_handler', name: 'users' },
        onDelete: 'CASCADE',
      },
      preference_key: {
        type: 'varchar(50)',
        notNull: true,
      },
      preference_value: {
        type: 'text',
        notNull: false,
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
    },
    { ifNotExists: true }
  );

  // Step 6: Create UNIQUE constraint on (user_id, preference_key)
  pgm.addConstraint(
    { schema: 'whatsapp_handler', name: 'user_preferences' },
    'uq_user_preferences_user_key',
    {
      unique: ['user_id', 'preference_key'],
    }
  );

  // Step 7: Create index for user_preferences
  pgm.createIndex(
    { schema: 'whatsapp_handler', name: 'user_preferences' },
    'user_id',
    { name: 'idx_user_preferences_user', ifNotExists: true }
  );

  // Step 8: Create outbox_events table
  pgm.createTable(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('uuid_generate_v4()'),
      },
      aggregate_id: {
        type: 'uuid',
        notNull: true,
      },
      event_type: {
        type: 'varchar(100)',
        notNull: true,
      },
      event_version: {
        type: 'varchar(10)',
        notNull: true,
        default: '1.0',
      },
      payload: {
        type: 'jsonb',
        notNull: true,
      },
      metadata: {
        type: 'jsonb',
        notNull: false,
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
      published_at: {
        type: 'timestamptz',
        notNull: false,
      },
    },
    { ifNotExists: true }
  );

  // Step 9: Create indexes for outbox_events
  pgm.createIndex(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    'published_at',
    {
      name: 'idx_outbox_events_published',
      where: 'published_at IS NULL',
      ifNotExists: true,
    }
  );

  pgm.createIndex(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    'created_at',
    { name: 'idx_outbox_events_created', ifNotExists: true }
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Step 1: Drop indexes (in reverse order)
  pgm.dropIndex(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    'created_at',
    { name: 'idx_outbox_events_created', ifExists: true }
  );

  pgm.dropIndex(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    'published_at',
    { name: 'idx_outbox_events_published', ifExists: true }
  );

  pgm.dropIndex(
    { schema: 'whatsapp_handler', name: 'user_preferences' },
    'user_id',
    { name: 'idx_user_preferences_user', ifExists: true }
  );

  pgm.dropIndex(
    { schema: 'whatsapp_handler', name: 'users' },
    'verified_at',
    { name: 'idx_users_verified', ifExists: true }
  );

  pgm.dropIndex(
    { schema: 'whatsapp_handler', name: 'users' },
    'phone_number',
    { name: 'idx_users_phone', ifExists: true }
  );

  // Step 2: Drop tables (CASCADE to handle FK dependencies)
  pgm.dropTable(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    { ifExists: true, cascade: true }
  );

  pgm.dropTable(
    { schema: 'whatsapp_handler', name: 'user_preferences' },
    { ifExists: true, cascade: true }
  );

  pgm.dropTable(
    { schema: 'whatsapp_handler', name: 'users' },
    { ifExists: true, cascade: true }
  );

  // Step 3: Drop schema (CASCADE to handle any remaining objects)
  pgm.dropSchema('whatsapp_handler', { ifExists: true, cascade: true });
}
```

### Idempotency Checklist
- [x] `CREATE SCHEMA ... IF NOT EXISTS`
- [x] `CREATE EXTENSION IF NOT EXISTS`
- [x] `createTable(..., { ifNotExists: true })`
- [x] `createIndex(..., { ifNotExists: true })`
- [x] `DROP ... IF EXISTS` in down() function
- [x] Migration can be run multiple times safely

---

## Integration Test Requirements

### Test File Structure

**Location**: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/whatsapp-handler/tests/integration/database-schema.test.ts`

**Test Coverage**:

1. **Test: Schema creation**
   - Verify schema `whatsapp_handler` exists
   - Verify uuid-ossp extension enabled

2. **Test: Users table constraints**
   - Insert user with phone_number
   - Verify UNIQUE constraint prevents duplicate phone_number
   - Verify phone_number NOT NULL constraint

3. **Test: User preferences FK cascade delete**
   - Insert user
   - Insert user_preferences for user
   - Delete user
   - Verify user_preferences are also deleted (CASCADE)

4. **Test: User preferences UNIQUE constraint**
   - Insert user
   - Insert preference (user_id, preference_key='language')
   - Attempt duplicate preference (same user_id, same preference_key)
   - Verify UNIQUE constraint violation

5. **Test: Outbox events index on published_at IS NULL**
   - Insert outbox_event with published_at=NULL
   - Query WHERE published_at IS NULL
   - Verify index usage with EXPLAIN ANALYZE

6. **Test: Schema isolation (ADR-001)**
   - Verify NO cross-schema foreign keys
   - Attempt to create FK to different schema (should fail)

**Testcontainers Setup**:
```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { migrate } from 'node-pg-migrate';

describe('Database Schema Integration Tests', () => {
  let container: PostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    // Start Testcontainers PostgreSQL
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('test')
      .withUsername('test')
      .withPassword('test')
      .start();

    // Connect to database
    client = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await client.connect();

    // Run migrations
    await migrate({
      databaseUrl: container.getConnectionUri(),
      direction: 'up',
      migrationsTable: 'pgmigrations',
    });
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  // Tests here...
});
```

---

## Summary for Hoops

### What You Need to Create

1. **RFC Document** (`docs/RFC-whatsapp-handler-schema.md`):
   - Business context (why these tables?)
   - Schema design (3 tables, indexes, constraints)
   - Alternatives considered (why Redis for FSM, why Twilio Verify for OTP, why timetable-loader API for stations)

2. **Migration File** (`migrations/TIMESTAMP_create_whatsapp_handler_schema.ts`):
   - UP: Create schema, tables, indexes (idempotent)
   - DOWN: Drop tables, drop schema (idempotent)
   - Use template above

3. **Integration Tests** (`tests/integration/database-schema.test.ts`):
   - Testcontainers PostgreSQL setup
   - Tests for constraints, FKs, indexes
   - All tests FAIL before migration, PASS after migration

4. **Query Plans** (`docs/QUERY-PLANS.md`):
   - EXPLAIN ANALYZE for common queries
   - Verify <100ms p99 performance

5. **Documentation Updates**:
   - `README.md`: Add database schema section
   - `docs/ERD.md`: Create entity-relationship diagram

### What You Must NOT Create

Based on architectural decisions:
- ❌ NO custom OTP table (Twilio Verify handles this)
- ❌ NO station cache table (timetable-loader API handles this)
- ❌ NO session timeout columns (Redis TTL handles this)

### Quality Gates to Meet

- [x] TDD compliance (tests BEFORE migration code)
- [x] Schema isolation (whatsapp_handler schema, NO cross-service FKs)
- [x] Idempotent migrations (IF NOT EXISTS / IF EXISTS)
- [x] All tests GREEN after migration
- [x] Performance validated (<100ms p99)

### Blocking Rule

**Phase 3 (Blake) cannot begin until Hoops delivers GREEN migrations.**

---

**End of Schema Analysis for Hoops**
