# whatsapp-handler

WhatsApp conversation handler and user authentication service for RailRepay MVP.

## Service Overview

**Owner**: whatsapp-handler service
**Schema**: `whatsapp_handler`
**Phase**: 2 (Data Layer Complete)

This service serves as the primary user-facing entry point for RailRepay, managing WhatsApp conversations via Twilio webhooks, user registration, OTP verification, and conversation state machine.

## Related Documentation

- **Specification**: `/specifications/whatsapp-handler-specification.md`
- **RFC**: `docs/RFC-001-schema-design.md`
- **Notion**: Service Layer › whatsapp-handler
- **User Stories**: RAILREPAY-001, RAILREPAY-002, RAILREPAY-600, RAILREPAY-701, RAILREPAY-800

## Architecture Compliance

- **ADR-001**: Schema-per-service isolation (`whatsapp_handler` schema)
- **ADR-003**: node-pg-migrate for migrations
- **ADR-004**: Vitest for testing
- **ADR-014**: TDD workflow (tests written first)

## Database Schema

### Tables

1. **users** - User authentication via phone number
   - Primary identity: `phone_number` (E.164 format)
   - OTP verification tracking
   - Soft-delete pattern (GDPR compliance)

2. **user_preferences** - User settings
   - One-to-one with users (unique constraint)
   - Notification preferences, language, timezone
   - Auto-claim settings

3. **outbox_events** - Transactional outbox pattern
   - Events: `user.registered`, `user.verified`, `conversation.started`, `ticket.uploaded`
   - Polled by `outbox-relay` service for Pub/Sub publishing

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- PostgreSQL 15+ (or Railway PostgreSQL)
- Redis (for FSM state)

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/railway
DATABASE_SCHEMA=whatsapp_handler
SERVICE_NAME=whatsapp-handler

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Redis
REDIS_URL=redis://localhost:6379
```

### Database Migrations

```bash
# Run migrations
npm run migrate:up

# Rollback migrations
npm run migrate:down

# Create new migration
npm run migrate:create <migration-name>
```

### Running Tests

```bash
# Run all tests
npm test

# Run integration tests with Testcontainers
npm run test:integration

# Watch mode
npm run test:watch
```

### Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## API Endpoints

### Health Check

```http
GET /health
```

Returns service health status (database, Redis, Twilio connectivity).

### Metrics

```http
GET /metrics
```

Prometheus metrics endpoint (served on port 9090).

### Twilio Webhook

```http
POST /webhook/twilio
Content-Type: application/x-www-form-urlencoded
X-Twilio-Signature: <signature>

MessageSid=SM...
From=whatsapp:+447700900123
To=whatsapp:+14155238886
Body=Hello
```

## Testing

### Test Structure

```
tests/
├── integration/
│   └── migrations.test.ts   # Database schema integration tests
└── unit/
    └── (to be added by Blake in Phase 3)
```

### TDD Workflow (ADR-014)

1. Write failing tests FIRST
2. Implement migration to make tests pass
3. Verify all tests GREEN
4. Refactor if needed

### Coverage Thresholds

- Lines: ≥80%
- Functions: ≥80%
- Statements: ≥80%
- Branches: ≥75%

## Deployment (Railway)

### Pre-Deployment Checklist

- [ ] All tests passing (`npm test`)
- [ ] Migrations tested locally with Testcontainers
- [ ] `.env.example` updated with new variables
- [ ] Documentation updated

### Deployment Steps

1. Push to GitHub main branch
2. Railway auto-deploys
3. Migrations run during startup: `npm run migrate:up && npm start`
4. Health check verifies service is running
5. Monitor metrics for 1 hour

### Rollback

```bash
# Railway native rollback
railway rollback

# OR manual migration rollback
railway run npm run migrate:down
```

## Monitoring

### Key Metrics

```prometheus
# User registration
whatsapp_user_registrations_total{status="success|failure"}
whatsapp_otp_sent_total{status="success|failure"}
whatsapp_otp_verified_total{status="success|failure"}

# Database queries
whatsapp_db_query_duration_seconds{query="user_lookup",quantile="0.95"}

# Outbox processing
whatsapp_outbox_events_created_total{event_type="user.registered"}
whatsapp_outbox_publish_lag_seconds{quantile="0.95"}
```

### Alert Thresholds

- DB query P95 > 1s for 5 minutes (critical)
- Outbox lag > 60s for 10 minutes (critical)
- OTP failure rate > 50% for 15 minutes (critical)

## Data Retention

- **Users**: Soft-delete with `blocked_at`, anonymize after 180 days inactivity (GDPR)
- **Preferences**: Cascade deleted with user
- **Outbox events**: Delete 7 days after `published_at`

## Technical Debt

See `docs/RFC-001-schema-design.md` § Technical Debt for known shortcuts and future improvements.

## Phase 2 Status

**Phase 2 (Data Layer) Deliverables**:
- [x] RFC document with business context
- [x] Service directory structure
- [x] package.json with node-pg-migrate, vitest, testcontainers
- [x] Failing integration tests (TDD)
- [x] Migration file (UP and DOWN)
- [ ] Tests passing (GREEN)
- [ ] Technical debt documented

**Next Phase**: Hand off to Blake for Phase 3 (Service Implementation)

## Support

For questions or issues, contact:
- Data Layer: Hoops (Data Architect)
- Service Implementation: Blake (Backend Engineer)
- QA: Jessie (QA & TDD Enforcer)
