# Technical Debt Register - whatsapp-handler Service

**Service**: whatsapp-handler
**Last Updated**: 2025-12-03
**Consolidated By**: Human review after Phase 6 close-out + SOP compliance audit + TD remediation

---

## Overview

This register consolidates ALL technical debt for the whatsapp-handler service, including:
- Schema/database-level debt (from Hoops - Phase 2)
- Application-level stubs and missing integrations (from Blake - Phase 3)
- Deployment-related debt (from Moykle - Phase 5)

**Status Legend**:
- :red_circle: **BLOCKING**: Must resolve before production use
- :yellow_circle: **DEFERRED**: Acceptable for MVP, address later
- :green_circle: **FUTURE**: Enhancement, not debt

---

## Summary Metrics

| Category | Count | Estimated Hours |
|----------|-------|-----------------|
| :red_circle: BLOCKING | 6 | 28h |
| :yellow_circle: DEFERRED | 11 | 23h |
| :green_circle: FUTURE | 5 | 16h |
| :white_check_mark: RESOLVED | 3 | 0h |
| **TOTAL** | **25** | **67h** |

**Coverage Note** (ADR-014): Overall test coverage is 74.87% (below 80% threshold). Coverage gaps documented in TD-019, TD-020, TD-021.

**SOP COMPLIANCE NOTE (Updated 2025-12-03)**:
- TD-WHATSAPP-006 (winston-logger): ✅ RESOLVED - Integrated via `src/lib/logger.ts`
- TD-WHATSAPP-011 (metrics-pusher): ✅ RESOLVED - Integrated via `src/routes/metrics.ts`
- TD-WHATSAPP-016 (postgres-client): ✅ RESOLVED - Integrated via `src/db/client.ts`
- TD-WHATSAPP-007 (redis-cache): 🟡 DEFERRED - Library API limitation prevents direct integration (see details below)

**Non-Applicable Shared Libraries**:
- `@railrepay/kafka-client`: Not applicable - whatsapp-handler produces events via transactional outbox, does not consume Kafka topics
- `@railrepay/openapi-validator`: Not applicable - Twilio webhook uses form-urlencoded format per Twilio spec, not JSON API

---

## :red_circle: BLOCKING - Must Fix Before Production

### TD-WHATSAPP-001: OTP Verification is a Stub :red_circle:

**Category**: Functional Gap
**Severity**: CRITICAL
**Created**: 2025-12-01 (Post Phase 6 review)

**Description**:
The OTP verification flow **does not actually verify codes**. The `otpHandler` accepts ANY 6-digit code as valid. The code says "I've sent a verification code" but never calls Twilio Verify API.

**Current Behavior**:
```typescript
// src/handlers/otp.handler.ts
// TODO: In production, verify code with Twilio Verify API
// For MVP, we'll accept any 6-digit code and move forward
const otpPattern = /^\d{6}$/;
if (otpPattern.test(trimmedInput)) {
  // Accepted without verification!
}
```

**Impact**:
- Users can "verify" with any 6-digit code (123456, 000000, etc.)
- No actual phone ownership validation
- Security vulnerability - anyone can claim any phone number

**Recommended Fix**:
```typescript
import { TwilioVerifyService } from '../services/twilio-verify.service';

// In otpHandler:
const verifyService = new TwilioVerifyService();
const result = await verifyService.checkVerification(ctx.phoneNumber, trimmedInput);
if (result.status !== 'approved') {
  return { response: 'Invalid code. Please try again.', nextState: FSMState.AWAITING_OTP };
}
```

**Owner**: Blake (Backend Engineer)
**Effort**: 4 hours
**Sprint Target**: Before any real user testing

---

### TD-WHATSAPP-002: Outbox Publisher Not Implemented :red_circle:

**Category**: Functional Gap
**Severity**: HIGH
**Created**: 2025-12-01 (Post Phase 6 review)

**Description**:
The transactional outbox pattern writes events to `whatsapp_handler.outbox_events` table, but there is **no publisher** to read these events and send them to Kafka/other services.

**Current Behavior**:
- Events (`user.verified`, `journey.created`) are inserted into `outbox_events` table
- `published_at` remains NULL forever
- No other service ever receives these events

**Impact**:
- Downstream services (journey-matcher, claim-dispatcher) never learn about new users or journeys
- Core business flow is broken - claims cannot be processed

**Recommended Fix**:
Create `src/services/outbox-publisher.ts`:
```typescript
// Poll unpublished events every N seconds
// Publish to Kafka topic
// Mark as published (set published_at)
// Handle failures with retry logic
```

**Owner**: Blake (Backend Engineer)
**Effort**: 8 hours
**Sprint Target**: Before end-to-end testing

---

### TD-WHATSAPP-003: Station Search API Missing from timetable-loader :red_circle:

**Category**: Integration Gap
**Severity**: HIGH
**Created**: 2025-12-01 (Post Phase 6 review)
**Updated**: 2025-12-03 (SOP compliance audit)

**Description**:
The `StationService` calls `timetable-loader` API to search for stations. The timetable-loader service **EXISTS and IS DEPLOYED** to Railway, but it **does NOT expose a station search endpoint**.

**timetable-loader Current API**:
- `POST /api/v1/services/validate` - RID validation (exists)
- `GET /health/ready` - Health check (exists)
- `GET /metrics` - Prometheus metrics (exists)
- `GET /api/v1/stations/search` - **DOES NOT EXIST**

**Current Behavior**:
```typescript
// src/services/station.service.ts
const TIMETABLE_LOADER_URL = process.env.TIMETABLE_LOADER_URL || 'http://localhost:3001';
const response = await fetch(`${TIMETABLE_LOADER_URL}/api/v1/stations/search?q=${query}`);
// Returns 404 (endpoint doesn't exist) or connection refused (wrong URL)
```

**Impact**:
- Station search always returns empty results (404 or connection refused)
- Users cannot select stations for their journey
- Journey capture flow is broken

**Recommended Fix**:
Add `/api/v1/stations/search` endpoint to timetable-loader service. The `StationReferenceService` class already has `getAllStations()` and `getStationByCRS()` methods - just needs HTTP routing.

**Implementation Steps**:
1. Create `src/api/station-routes.ts` in timetable-loader
2. Add `GET /api/v1/stations/search?q={query}` endpoint
3. Use existing `StationReferenceService.getAllStations()` with filter
4. Deploy updated timetable-loader to Railway

**Owner**: Blake (Backend Engineer) - add endpoint to timetable-loader
**Effort**: 4 hours
**Sprint Target**: Before journey capture testing

---

### TD-WHATSAPP-004: No Claim Creation :red_circle:

**Category**: Functional Gap
**Severity**: HIGH
**Created**: 2025-12-01 (Post Phase 6 review)

**Description**:
After journey capture is complete, the service says "We'll process your claim" but **no claim is actually created** in any claims service.

**Current Behavior**:
```typescript
// src/handlers/ticket-upload.handler.ts
const journeyEvent: OutboxEvent = {
  event_type: 'journey.created',
  // ... event data
};
return {
  response: "Journey submitted successfully! We'll process your claim...",
  publishEvents: [journeyEvent],
};
// But: outbox publisher doesn't exist (TD-WHATSAPP-002)
// And: no claims service to receive the event
```

**Impact**:
- Users think their claim is submitted
- No claim is created anywhere
- Core business function is missing

**Recommended Fix**:
1. First fix TD-WHATSAPP-002 (outbox publisher)
2. Build claim-dispatcher service to consume `journey.created` events
3. OR: Call claim-dispatcher API directly from handler

**Owner**: Quinn (Orchestrator) - architectural decision
**Effort**: Depends on approach (8-24 hours)
**Sprint Target**: Before any real user testing

---

### TD-WHATSAPP-005: Integration Tests Cannot Run (Docker/WSL) :red_circle:

**Category**: Testing
**Severity**: MEDIUM
**Created**: 2025-11-30 (Phase 2)

**Description**:
Testcontainers integration tests cannot run in WSL environment without Docker. Database migrations and constraints are not fully tested locally.

**Current Behavior**:
```
Error: Could not find a working container runtime strategy
```

**Impact**:
- Cannot verify database migrations work correctly
- Cannot test foreign key constraints, check constraints
- Must rely on Railway CI/CD to catch issues

**Recommended Fix**:
- Run integration tests in Docker-enabled CI/CD (Railway)
- OR: Install Docker Desktop with WSL2 integration
- OR: Use a real PostgreSQL instance for testing

**Owner**: Moykle (DevOps)
**Effort**: 2 hours
**Sprint Target**: Before Phase 5 deployment

---

### TD-WHATSAPP-006: @railrepay/winston-logger Not Used (SOP VIOLATION) :white_check_mark: RESOLVED

**Category**: SOP Compliance / Observability
**Severity**: ~~HIGH~~ RESOLVED
**Created**: 2025-12-01 (Post Phase 6 review)
**Resolved**: 2025-12-03 (TD Remediation Sprint)

**Resolution**:
✅ Integrated `@railrepay/winston-logger` via singleton pattern in `src/lib/logger.ts`.

**Implementation**:
```typescript
// src/lib/logger.ts
import { createLogger, Logger } from '@railrepay/winston-logger';

let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = createLogger({
      serviceName: process.env.SERVICE_NAME || 'whatsapp-handler',
      level: process.env.LOG_LEVEL || 'info',
      lokiEnabled: process.env.LOKI_ENABLED === 'true',
      lokiHost: process.env.LOKI_HOST,
      lokiBasicAuth: process.env.LOKI_BASIC_AUTH,
      environment: process.env.NODE_ENV || 'development',
    });
  }
  return loggerInstance;
}
```

**Files Modified**:
- `src/lib/logger.ts` - New singleton logger module
- `src/index.ts` - Updated to use getLogger()
- `src/db/client.ts` - Updated to use getLogger()
- `src/routes/metrics.ts` - Updated to use getLogger()

**Verification**: All 386 unit tests pass.

---

### TD-WHATSAPP-007: @railrepay/redis-cache Not Used (LIBRARY LIMITATION) :yellow_circle:

**Category**: SOP Compliance / Code Quality
**Severity**: ~~HIGH~~ LOW (downgraded due to library limitation)
**Created**: 2025-12-01 (Post Phase 6 review)
**Updated**: 2025-12-03 (Downgraded to DEFERRED - library API mismatch)

**Status**: DEFERRED - Cannot be fixed without library changes

**Description**:
The SOP **mandates** using `@railrepay/redis-cache` shared library for Redis operations. However, investigation revealed an **API mismatch** that prevents direct integration.

**Library Limitation Analysis**:
The `@railrepay/redis-cache` library provides a **high-level caching abstraction** with these methods:
- `get(key)` - Get cached value
- `set(key, value, ttlSeconds)` - Set with TTL
- `delete(key)` - Remove key
- `exists(key)` - Check if key exists

However, whatsapp-handler requires **low-level Redis operations** for:

1. **Rate Limiting** (`src/middleware/rate-limiter.ts`):
   ```typescript
   await redis.incr(key);         // Atomic increment
   await redis.expire(key, ttl);  // Set expiration
   await redis.ttl(key);          // Get remaining TTL
   ```

2. **FSM State Management** (`src/services/fsm.service.ts`):
   ```typescript
   await redis.hset(key, 'state', state);  // Hash set
   await redis.hgetall(key);               // Get all hash fields
   ```

3. **Idempotency Checking** (`src/routes/webhook.ts`):
   ```typescript
   await redis.setex(key, ttl, value);  // Set with expiration
   ```

**Why Integration is Not Possible**:
- The shared library uses `node-redis v4` internally but does NOT expose the raw client
- No `incr()`, `expire()`, `ttl()`, `hset()`, `hgetall()`, `setex()` methods available
- The library is designed for **simple caching patterns**, not **low-level Redis operations**

**Current Implementation (Acceptable)**:
```typescript
// src/index.ts - Using ioredis directly
import Redis from 'ioredis';
const redis = new Redis(config.redis.url);
// TODO (TD-WHATSAPP-018): Migrate to @railrepay/redis-cache when library supports low-level ops
```

**Recommended Fix Options**:

**Option A**: Enhance `@railrepay/redis-cache` library to expose raw client:
```typescript
// Add to @railrepay/redis-cache:
export function getRawClient(): RedisClientType;
// Or add specialized methods:
export async function incr(key: string): Promise<number>;
export async function expire(key: string, seconds: number): Promise<boolean>;
```

**Option B**: Create new `@railrepay/redis-advanced` library for low-level operations.

**Option C**: Accept current ioredis usage as valid for services requiring low-level Redis.

**Impact** (Mitigated):
- ioredis is a well-maintained, production-ready library
- Health checks are already implemented via `redis.ping()`
- Graceful degradation handled in middleware (returns 429 on Redis failure)
- Key prefixing implemented manually (`ratelimit:`, `fsm:`, `idempotent:`)

**Owner**: Hoops (Data Architect) - library enhancement decision
**Effort**: 8 hours (if library enhancement chosen)
**Sprint Target**: Post-MVP (requires architectural decision)

**Cross-Reference**: New tech debt item TD-WHATSAPP-018 created to track this.

---

### TD-WHATSAPP-011: @railrepay/metrics-pusher Not Used (SOP VIOLATION) :white_check_mark: RESOLVED

**Category**: SOP Compliance / Observability
**Severity**: ~~HIGH~~ RESOLVED
**Created**: 2025-12-01 (Post Phase 6 review)
**Resolved**: 2025-12-03 (TD Remediation Sprint)

**Resolution**:
✅ Fully integrated `@railrepay/metrics-pusher` with counter increments in webhook handler.

**Implementation**:

1. **Metrics Initialization** (`src/routes/metrics.ts`):
```typescript
import {
  createMetricsRouter as createSharedMetricsRouter,
  getRegistry,
  Counter,
  Histogram,
  Gauge,
} from '@railrepay/metrics-pusher';

export function initializeMetrics(): void {
  const registry = getRegistry();
  collectDefaultMetrics({ register: registry });

  messagesReceivedCounter = new Counter({
    name: 'whatsapp_messages_received_total',
    labelNames: ['status'] as const,
    registers: [registry],
  });
  // ... other metrics
}
```

2. **MetricsPusher Started** (`src/index.ts`):
```typescript
import { MetricsPusher } from '@railrepay/metrics-pusher';

const metricsPusher = new MetricsPusher({
  serviceName: config.serviceName,
  logger,
});
await metricsPusher.start();

// Graceful shutdown
metricsPusher.stop();
```

3. **Counter Increments** (`src/routes/webhook.ts`):
```typescript
messagesReceivedCounter?.inc({ status: 'received' });
messagesReceivedCounter?.inc({ status: 'duplicate' });
messagesReceivedCounter?.inc({ status: 'error' });
messagesSentCounter?.inc({ status: 'success' });
webhookDurationHistogram?.observe(durationSeconds);
```

**Files Modified**:
- `package.json` - Added `@railrepay/metrics-pusher` dependency
- `src/routes/metrics.ts` - Complete refactor to use shared library
- `src/routes/webhook.ts` - Added counter increments
- `src/index.ts` - Added MetricsPusher initialization and shutdown
- `tests/unit/routes/metrics.test.ts` - Updated mocks to support shared library API

**Custom WhatsApp Metrics Registered**:
- `whatsapp_messages_received_total` (Counter with status label)
- `whatsapp_messages_sent_total` (Counter with status label)
- `whatsapp_user_registrations_total` (Counter)
- `whatsapp_otp_verifications_total` (Counter)
- `whatsapp_journeys_created_total` (Counter)
- `whatsapp_webhook_duration_seconds` (Histogram)
- `whatsapp_fsm_transition_duration_seconds` (Histogram)
- `whatsapp_active_sessions_total` (Gauge)

**Verification**: All 386 unit tests pass.

---

### TD-WHATSAPP-016: @railrepay/postgres-client Not Used (SOP VIOLATION) :white_check_mark: RESOLVED

**Category**: SOP Compliance / Data Access
**Severity**: ~~HIGH~~ RESOLVED
**Created**: 2025-12-03 (SOP compliance audit via Extractable Packages Registry)
**Resolved**: 2025-12-03 (TD Remediation Sprint)

**Resolution**:
✅ Integrated `@railrepay/postgres-client` with wrapper for backward compatibility.

**Implementation** (`src/db/client.ts`):
```typescript
import { PostgresClient, type Pool } from '@railrepay/postgres-client';
import { getLogger } from '../lib/logger.js';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
  ssl?: boolean;
}

export interface DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
  initialize(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  getPool(): Pool;
}

export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  const logger = getLogger();

  const postgresClient = new PostgresClient({
    serviceName: 'whatsapp-handler',
    schemaName: config.schema,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    logger,
  });

  return {
    async query<T = any>(sql: string, params?: any[]) {
      return postgresClient.query<T>(sql, params);
    },
    async initialize() {
      await postgresClient.connect();
    },
    async disconnect() {
      await postgresClient.disconnect();
    },
    async healthCheck() {
      return postgresClient.healthCheck();
    },
    getPool() {
      return postgresClient.getPool();
    },
  };
}
```

**Features Now Available**:
- ✅ Automatic schema isolation (ADR-001 compliant)
- ✅ Connection pooling with health checks
- ✅ Graceful shutdown handling
- ✅ Pool statistics for observability
- ✅ Structured logging via winston integration

**Files Modified**:
- `package.json` - Added `@railrepay/postgres-client` dependency
- `src/db/client.ts` - Refactored to use PostgresClient with wrapper
- `src/index.ts` - Updated to use createDatabaseClientFromEnv()

**Verification**: All 386 unit tests pass, TypeScript build succeeds.

---

## :yellow_circle: DEFERRED - Acceptable for MVP

### TD-WHATSAPP-008: No Phone Number Format Validation in Database :yellow_circle:

**Category**: Data Integrity
**Severity**: LOW
**Created**: 2025-11-30 (Phase 2)

**Description**:
Phone numbers are validated at application layer (Zod schema) but no CHECK constraint in database.

**Impact**:
- Application validation works correctly
- Risk: Direct database access could insert invalid data

**Recommended Fix**:
```sql
ALTER TABLE whatsapp_handler.users
ADD CONSTRAINT chk_phone_e164 CHECK (phone_number ~ '^\+[1-9]\d{1,14}$');
```

**Owner**: Hoops (Data Architect)
**Effort**: 1 hour
**Sprint Target**: Q1 2026 hardening

---

### TD-WHATSAPP-009: Preference Values Not Typed :yellow_circle:

**Category**: Schema Design
**Severity**: LOW
**Created**: 2025-11-30 (Phase 2)

**Description**:
`user_preferences.preference_value` is TEXT, allowing any string. No database-level validation for JSON values.

**Impact**:
- Works correctly at MVP scale
- Schema evolution may be harder if values are inconsistent

**Recommended Fix**:
Monitor usage patterns for 3 months, then either:
- Convert to JSONB column
- Or add typed columns for known preferences

**Owner**: Hoops (Data Architect)
**Effort**: 4 hours
**Sprint Target**: Q2 2026

---

### TD-WHATSAPP-010: No Event Retention Enforcement :yellow_circle:

**Category**: Operational
**Severity**: LOW
**Created**: 2025-11-30 (Phase 2)

**Description**:
7-day retention for `outbox_events` relies on cron job (not implemented), not database trigger.

**Impact**:
- Table will grow indefinitely until cron is configured
- At MVP scale (500 events/day), acceptable for months

**Recommended Fix**:
Add pg_cron job or database trigger to delete old events.

**Owner**: Blake (Backend Engineer)
**Effort**: 2 hours
**Sprint Target**: After outbox publisher (TD-WHATSAPP-002) is working

---

### TD-WHATSAPP-012: Twilio Sandbox Mode :yellow_circle:

**Category**: External Dependency
**Severity**: MEDIUM
**Created**: 2025-11-30 (Phase 0)

**Description**:
Twilio WhatsApp is in sandbox mode, not production approved.

**Impact**:
- Limited to pre-registered test phone numbers
- Cannot receive messages from general public

**Recommended Fix**:
Apply for Twilio WhatsApp Business API production access.

**Owner**: Human (Business decision)
**Effort**: 1-4 weeks (Twilio approval process)
**Sprint Target**: Before public launch

---

### TD-WHATSAPP-013: v1.0 Types File Still Exists :yellow_circle:

**Category**: Code Cleanup
**Severity**: LOW
**Created**: 2025-11-30 (Phase 3)

**Description**:
`src/db/types.ts` (v1.0 schema with 14 columns) still exists alongside `src/db/types.v2.ts` (v2.0 schema with 5 columns). Code uses v2 but v1 file causes confusion.

**Impact**:
- No runtime impact (v2 is used)
- Developer confusion about which types to use

**Recommended Fix**:
```bash
rm src/db/types.ts
mv src/db/types.v2.ts src/db/types.ts
# Update all imports
```

**Owner**: Blake (Backend Engineer)
**Effort**: 30 minutes
**Sprint Target**: Next cleanup sprint

---

### TD-WHATSAPP-014: Terms URL is Hardcoded :yellow_circle:

**Category**: Configuration
**Severity**: LOW
**Created**: 2025-12-01 (Post Phase 6 review)

**Description**:
Terms and conditions URL is hardcoded in handler.

**Current Behavior**:
```typescript
// src/handlers/terms.handler.ts
const TERMS_URL = 'https://railrepay.co.uk/terms';
```

**Impact**:
- Cannot change URL without code deployment
- Minor issue for MVP

**Recommended Fix**:
Move to environment variable or configuration.

**Owner**: Blake (Backend Engineer)
**Effort**: 15 minutes
**Sprint Target**: Next cleanup sprint

---

### TD-WHATSAPP-015: No Input Sanitization for User Messages :yellow_circle:

**Category**: Security
**Severity**: MEDIUM
**Created**: 2025-12-01 (Post Phase 6 review)

**Description**:
User message body is used directly in responses and logs without sanitization.

**Current Behavior**:
```typescript
const input = ctx.messageBody.trim().toUpperCase();
// No XSS sanitization, no length limits beyond Twilio's
```

**Impact**:
- TwiML responses use XML escaping (MessageFormatterService handles this)
- Logs could contain malicious content
- Low risk since WhatsApp messages are text-only

**Recommended Fix**:
Add input length validation and sanitization for logging.

**Owner**: Blake (Backend Engineer)
**Effort**: 1 hour
**Sprint Target**: Q1 2026 security hardening

---

### TD-WHATSAPP-019: src/index.ts Startup Logic Not Tested :yellow_circle:

**Category**: Test Coverage
**Severity**: MEDIUM
**Created**: 2025-12-03 (Phase 4 QA Review - Jessie)

**Description**:
The main application entry point (src/index.ts) has 0% test coverage. This includes:
- MetricsPusher initialization (lines 49-53)
- Database client initialization (lines 32-35)
- Redis client initialization (line 39)
- Express app configuration (lines 56-102)
- Graceful shutdown logic (lines 122-161)

**Impact**:
- Startup failures not caught by tests
- Shutdown logic (SIGTERM/SIGINT handling) not verified
- MetricsPusher start/stop lifecycle not tested

**Recommended Fix**:
Create tests/unit/index.test.ts with:
- Mock database, Redis, MetricsPusher dependencies
- Test graceful shutdown scenarios
- Verify proper resource cleanup

**Owner**: Blake (Backend Engineer)
**Effort**: 4 hours
**Sprint Target**: Q1 2026 hardening

---

### TD-WHATSAPP-020: Handler Registry Initialization Not Tested :yellow_circle:

**Category**: Test Coverage
**Severity**: LOW
**Created**: 2025-12-03 (Phase 4 QA Review - Jessie)

**Description**:
Handler registry initialization in src/handlers/index.ts (lines 90-119) has no test coverage. The initializeHandlers() function registers all 9 FSM handlers but is never called in tests.

**Impact**:
- Handler registration failures not caught
- Missing handlers would only be detected at runtime

**Recommended Fix**:
Add test in tests/unit/handlers/registry.test.ts:
- Call initializeHandlers()
- Verify all expected handlers registered
- Test getHandler() returns correct handler for each state

**Owner**: Blake (Backend Engineer)
**Effort**: 1 hour
**Sprint Target**: Next cleanup sprint

---

### TD-WHATSAPP-021: Webhook Event Publishing Not Tested :yellow_circle:

**Category**: Test Coverage
**Severity**: MEDIUM
**Created**: 2025-12-03 (Phase 4 QA Review - Jessie)

**Description**:
Event publishing logic in src/routes/webhook.ts (lines 171-180) has no test coverage. This code publishes events to the transactional outbox but is not exercised by unit tests.

**Impact**:
- Outbox event insertion failures not caught
- Event payload format not verified by tests

**Recommended Fix**:
Add test in tests/unit/routes/webhook.test.ts:
- Mock OutboxRepository.insertEvent()
- Verify events published for user verification, journey creation
- Verify event payload structure

**Owner**: Blake (Backend Engineer)
**Effort**: 2 hours
**Sprint Target**: Before Phase 5 deployment

---

## :green_circle: FUTURE - Enhancements (Not Debt)

### FUTURE-001: Add correlation_id to outbox_events Table

**Description**: Enable distributed tracing by adding correlation_id column.

**When to Implement**: When observability platform (Datadog/New Relic) deployed.

**Owner**: Hoops
**Effort**: 2 hours

---

### FUTURE-002: Add event_version for Schema Evolution

**Description**: Enable backward-compatible event schema changes.

**When to Implement**: When first breaking event schema change occurs.

**Owner**: Blake
**Effort**: 1 hour

---

### FUTURE-003: GDPR Soft-Delete Pattern

**Description**: Anonymize instead of DELETE for audit trail.

**When to Implement**: If legal/compliance requires audit trail.

**Owner**: Hoops
**Effort**: 4 hours

---

### FUTURE-004: Preferences Caching in Redis

**Description**: Cache frequently accessed preferences to reduce DB load.

**When to Implement**: When P95 query latency >50ms or user count >10K.

**Owner**: Blake
**Effort**: 1 hour

---

### FUTURE-005 (TD-WHATSAPP-018): Enhance @railrepay/redis-cache for Low-Level Operations

**Description**: The @railrepay/redis-cache library provides high-level caching abstraction but doesn't support low-level Redis operations needed by whatsapp-handler (incr, expire, ttl, hset, hgetall, setex).

**Background**: TD-WHATSAPP-007 was DEFERRED because the library API doesn't match whatsapp-handler requirements. This item tracks the library enhancement work.

**Options**:
1. Add `getRawClient()` export to @railrepay/redis-cache
2. Add specialized methods (`incr`, `expire`, etc.) to the library
3. Create new @railrepay/redis-advanced library
4. Document ioredis as acceptable for services requiring low-level operations

**When to Implement**: When additional services need low-level Redis operations.

**Owner**: Hoops (Data Architect) - architectural decision required
**Effort**: 8 hours

---

## Review Schedule

- **Weekly**: Check for new debt during sprint planning
- **Monthly**: Review DEFERRED items for re-prioritization
- **Quarterly**: Assess FUTURE enhancements

**Next Review**: 2025-12-08

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2025-11-30 | Hoops | Created initial register (Phase 2) |
| 2025-11-30 | Blake | Added v1.0/v2.0 schema mismatch items |
| 2025-11-30 | Moykle | Added deployment items from DEPLOYMENT-READINESS-REPORT |
| 2025-12-01 | Human Review | Consolidated all sources, added functional stubs (TD-001-004) |
| 2025-12-03 | SOP Audit | Upgraded TD-006/007/011 to BLOCKING (shared library violations); Updated TD-003 (timetable-loader exists but missing station search endpoint) |
| 2025-12-03 | SOP Audit | Added TD-016 (@railrepay/postgres-client not used); Documented kafka-client and openapi-validator as not applicable |
| 2025-12-03 | Blake (TD Remediation) | ✅ RESOLVED: TD-006 (winston-logger via src/lib/logger.ts) |
| 2025-12-03 | Blake (TD Remediation) | ✅ RESOLVED: TD-011 (metrics-pusher with counter increments) |
| 2025-12-03 | Blake (TD Remediation) | ✅ RESOLVED: TD-016 (postgres-client via src/db/client.ts wrapper) |
| 2025-12-03 | Blake (TD Remediation) | 🟡 DEFERRED: TD-007 (redis-cache - library API limitation prevents integration; created FUTURE-005/TD-018) |
| 2025-12-03 | Jessie (QA Review) | Added TD-019/020/021 for coverage gaps; Overall coverage 74.87% below ADR-014 thresholds |

---

**Document Location**: `/services/whatsapp-handler/TECHNICAL-DEBT-REGISTER.md`
**Related Documents**:
- `docs/RFC-whatsapp-handler-schema-v2.md`
- `DEPLOYMENT-READINESS-REPORT.md`
- `specifications/whatsapp-handler-COMPLETE-v2.md`
