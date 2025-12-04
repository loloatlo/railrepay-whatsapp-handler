# Phase 2 → Phase 3 Handoff: whatsapp-handler

**From**: Hoops (Data Architect - Phase 2)
**To**: Blake (Backend Engineer - Phase 3)
**Date**: 2025-11-30
**Status**: ✅ Ready for Implementation

---

## Quick Start for Blake

### 1. Review Key Documents (15 minutes)

**Start here**:
1. `/specifications/whatsapp-handler-specification.md` - Full requirements
2. `docs/RFC-001-schema-design.md` - Schema design rationale
3. `PHASE-2-COMPLETION-REPORT.md` - What Hoops completed

**Optional (reference as needed)**:
- `README.md` - Getting started guide
- `TECHNICAL-DEBT-REGISTER.md` - Known shortcuts to avoid

### 2. Understand the Schema (10 minutes)

**3 Tables Created**:

```sql
-- Users: Phone-based authentication
whatsapp_handler.users
  - id (UUID, PK)
  - phone_number (VARCHAR(20), UNIQUE) ← Primary identity
  - verified_at, otp_secret, otp_verified_at ← OTP flow
  - blocked_at, block_reason ← Soft delete (GDPR)

-- Preferences: User settings (1-to-1 with users)
whatsapp_handler.user_preferences
  - user_id (UUID, FK to users, CASCADE DELETE, UNIQUE)
  - notification_enabled, language, timezone
  - delay_threshold_minutes, auto_claim_enabled

-- Events: Transactional outbox pattern
whatsapp_handler.outbox_events
  - aggregate_id, event_type, payload (JSONB)
  - published_at IS NULL ← Unpublished events
```

**Key Relationships**:
- user_preferences.user_id → users.id (CASCADE DELETE)
- No other foreign keys (schema isolation per ADR-001)

### 3. Run Migrations Locally (5 minutes)

```bash
# Install dependencies (already done)
npm install

# Set up local PostgreSQL
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=test postgres:15-alpine

# Configure .env
cp .env.example .env
# Edit DATABASE_URL=postgresql://postgres:test@localhost:5432/railway

# Run migrations
npm run migrate:up

# Verify schema
psql $DATABASE_URL -f scripts/verify-migration.sql
```

**Expected Output**:
```
✅ Schema whatsapp_handler exists
✅ 3 tables created
✅ 7 indexes created
✅ Cascade delete working
```

### 4. Your Phase 3 Tasks

**Core Implementation** (TDD - Tests First):

1. **Create Repository Layer** (`src/db/repositories/`):
   - `UserRepository.ts` - CRUD for users table
   - `UserPreferencesRepository.ts` - Preferences management
   - `OutboxRepository.ts` - Event publishing

2. **Implement Business Logic**:
   - User registration flow (OTP generation/verification)
   - Phone number validation (E.164 format)
   - Soft-delete logic (blocked_at, block_reason)
   - Preferences defaults on user creation

3. **Event Publishing** (Outbox Pattern):
   - `user.registered` event on successful registration
   - `user.verified` event on OTP verification
   - `conversation.started` event on first message
   - `ticket.uploaded` event on photo receipt

4. **API Endpoints**:
   - `POST /webhook/twilio` - Twilio webhook handler
   - `GET /health` - Health check (database, Redis, Twilio)
   - `GET /metrics` - Prometheus metrics

**Testing**:
- Write **failing unit tests FIRST** (TDD per ADR-014)
- Mock database dependencies (no real DB in unit tests)
- Use Hoops' integration tests for database validation
- Target: ≥80% coverage (lines/functions/statements)

**Observability**:
- Winston logging with correlation IDs (ADR-002)
- Prometheus metrics (ADR-006)
- Loki integration (ADR-007)

---

## Schema Design Decisions (Why Things Are This Way)

### Why phone_number is UNIQUE (Not Just Indexed)?
**Reason**: One account per phone number (business rule)
**Your code**: Check for existing phone before INSERT
```typescript
const existing = await userRepo.findByPhone(phoneNumber);
if (existing) throw new ConflictError('Phone number already registered');
```

### Why user_preferences has CASCADE DELETE?
**Reason**: When user is hard-deleted (GDPR), preferences are orphaned data
**Your code**: Soft-delete users normally (set blocked_at), hard-delete only for GDPR
```typescript
// Soft delete (normal flow)
await userRepo.update(userId, { blocked_at: new Date(), block_reason: 'User requested' });

// Hard delete (GDPR only)
await userRepo.delete(userId); // Preferences auto-deleted via CASCADE
```

### Why outbox_events uses JSONB?
**Reason**: Event schema evolution without ALTER TABLE
**Your code**: Version your event payloads
```typescript
const event = {
  event_type: 'user.registered',
  event_version: '1.0', // Increment when schema changes
  payload: {
    user_id: userId,
    phone_number: phoneNumber,
    registered_at: new Date(),
  },
};
await outboxRepo.insert(event);
```

### Why partial index on verified_at?
**Reason**: Analytics queries only care about verified users
**Your code**: Leverage the index
```typescript
// This query uses idx_users_verified
const verifiedUsers = await db.query(`
  SELECT COUNT(*) FROM whatsapp_handler.users WHERE verified_at IS NOT NULL
`);
```

---

## Cross-Service References (API Validation Required)

Per ADR-001, no cross-schema foreign keys. Validate via API calls:

### Example: Validate User Exists (for journey-matcher)

```typescript
// journey-matcher calls whatsapp-handler
const response = await fetch(`http://whatsapp-handler.railway.internal:3000/api/v1/users/${userId}`);
if (!response.ok) {
  throw new Error('Invalid user_id - user not found in whatsapp-handler');
}
// Safe to store userId in journey_matcher.journeys
```

**Your API contract** (whatsapp-handler must provide):
```typescript
// GET /api/v1/users/:id
router.get('/api/v1/users/:id', async (req, res) => {
  const user = await userRepo.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id,
    phone_number: user.phone_number,
    verified: !!user.verified_at,
  });
});
```

---

## Database Connection Pattern

**Use Connection Pooling** (per SOPs):

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum pool size
  min: 2,  // Minimum idle connections
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

// Set schema search path
await pool.query(`SET search_path TO whatsapp_handler, public`);

// Repository pattern
class UserRepository {
  constructor(private pool: Pool) {}

  async findByPhone(phoneNumber: string): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE phone_number = $1',
      [phoneNumber]
    );
    return result.rows[0] || null;
  }
}
```

---

## TDD Workflow Example

### Step 1: Write Failing Test
```typescript
// tests/unit/repositories/UserRepository.test.ts
describe('UserRepository', () => {
  it('should create user with valid phone number', async () => {
    const repo = new UserRepository(mockPool);
    const user = await repo.create({
      phone_number: '+447700900123',
      registered_at: new Date(),
    });

    expect(user.id).toBeDefined();
    expect(user.phone_number).toBe('+447700900123');
  });

  it('should throw error on duplicate phone number', async () => {
    const repo = new UserRepository(mockPool);
    await repo.create({ phone_number: '+447700900123' });

    await expect(
      repo.create({ phone_number: '+447700900123' })
    ).rejects.toThrow('Phone number already exists');
  });
});
```

### Step 2: Implement to Pass Test
```typescript
// src/db/repositories/UserRepository.ts
export class UserRepository {
  async create(data: CreateUserDTO): Promise<User> {
    try {
      const result = await this.pool.query(
        `INSERT INTO users (phone_number, registered_at)
         VALUES ($1, $2)
         RETURNING *`,
        [data.phone_number, data.registered_at || new Date()]
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        throw new ConflictError('Phone number already exists');
      }
      throw error;
    }
  }
}
```

### Step 3: Verify Tests Pass
```bash
npm test
```

---

## Technical Debt to Avoid

From `TECHNICAL-DEBT-REGISTER.md`:

### ❌ Don't Do This:
```typescript
// Storing plaintext OTP (TD-WHATSAPP-001)
await db.query('UPDATE users SET otp_secret = $1', ['123456']); // BAD
```

### ✅ Do This Instead:
```typescript
// Hash OTP before storage
import bcrypt from 'bcrypt';
const hashedOTP = await bcrypt.hash('123456', 10);
await db.query('UPDATE users SET otp_secret = $1', [hashedOTP]); // GOOD
```

### ❌ Don't Do This:
```typescript
// Accepting any phone format (TD-WHATSAPP-002)
await userRepo.create({ phone_number: '07700900123' }); // BAD (missing +44)
```

### ✅ Do This Instead:
```typescript
// Validate E.164 format BEFORE database
const phoneSchema = z.string().regex(/^\+[1-9]\d{1,14}$/);
phoneSchema.parse(phoneNumber); // Throws if invalid
await userRepo.create({ phone_number }); // GOOD
```

---

## Integration Tests (Already Written by Hoops)

**File**: `tests/integration/migrations.test.ts`

**What it tests**:
- Schema creation
- Table structure (all columns present)
- Indexes created correctly
- Constraints enforced (unique, NOT NULL, FK)
- Cascade delete works
- Rollback migration works

**You don't need to modify these tests** - they verify the schema is correct.

**Your job**: Write unit tests for business logic on top of this schema.

---

## Metrics You Need to Implement

Per specification, expose these Prometheus metrics:

```typescript
import { Counter, Histogram, Gauge } from 'prom-client';

// User registration
const registrationCounter = new Counter({
  name: 'whatsapp_user_registrations_total',
  help: 'Total user registrations',
  labelNames: ['status'], // success|failure
});

// OTP
const otpSentCounter = new Counter({
  name: 'whatsapp_otp_sent_total',
  help: 'Total OTP codes sent',
  labelNames: ['status'],
});

// Database queries
const dbQueryDuration = new Histogram({
  name: 'whatsapp_db_query_duration_seconds',
  help: 'Database query duration',
  labelNames: ['query'], // user_lookup|preferences_fetch
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0],
});

// Outbox events
const outboxEventsCreated = new Counter({
  name: 'whatsapp_outbox_events_created_total',
  help: 'Outbox events created',
  labelNames: ['event_type'],
});
```

---

## Deployment Checklist (For Your Testing)

Before handing off to Jessie (Phase 4):

- [ ] All unit tests passing (≥80% coverage)
- [ ] Integration tests passing (Hoops already wrote these)
- [ ] Health check endpoint returns 200
- [ ] Metrics endpoint returns valid Prometheus format
- [ ] OpenAPI spec complete (`/openapi.yaml`)
- [ ] README updated with new endpoints
- [ ] No TODO comments in code
- [ ] ESLint/Prettier clean

---

## Questions? Ask Hoops

**Schema design questions**: Hoops (Data Architect)
**Business logic questions**: Check specification first, then ask Quinn
**Testing questions**: Jessie (QA)
**Deployment questions**: Moykle (DevOps)

---

## File Structure You're Inheriting

```
services/whatsapp-handler/
├── docs/
│   └── RFC-001-schema-design.md          ← Read this for "why"
├── migrations/
│   └── 001_create_whatsapp_handler_schema.ts  ← Done by Hoops
├── scripts/
│   └── verify-migration.sql               ← Manual testing script
├── src/
│   └── db/                                 ← You create repositories here
├── tests/
│   └── integration/
│       ├── migrations.test.ts             ← Done by Hoops (don't modify)
│       └── README.md
├── package.json                            ← Dependencies installed
├── .env.example                            ← Copy to .env
├── README.md                               ← Getting started
└── PHASE-2-COMPLETION-REPORT.md           ← What Hoops delivered
```

---

## Success Criteria for Phase 3

When you hand off to Jessie:

1. **Code**:
   - [ ] Repositories implemented (User, UserPreferences, Outbox)
   - [ ] Business logic implemented (registration, OTP, events)
   - [ ] API endpoints implemented (webhook, health, metrics)

2. **Tests**:
   - [ ] Unit tests ≥80% coverage (ADR-014)
   - [ ] Integration tests still passing (Hoops' tests)
   - [ ] All tests GREEN

3. **Documentation**:
   - [ ] OpenAPI spec complete
   - [ ] README updated
   - [ ] Environment variables documented

4. **Observability**:
   - [ ] Winston logging with correlation IDs
   - [ ] Prometheus metrics implemented
   - [ ] Health check working

---

**Good luck Blake! The schema is solid - build great things on it.**

**Next Phase**: Jessie will verify test coverage and quality (Phase 4)

---

**Prepared by**: Hoops (Data Architect)
**For**: Blake (Backend Engineer)
**Date**: 2025-11-30
**Phase Transition**: 2 → 3
