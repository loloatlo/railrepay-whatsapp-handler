# Integration Tests

## Prerequisites

Integration tests use **Testcontainers** to spin up real PostgreSQL instances. This requires:

1. **Docker** installed and running
2. **Docker daemon** accessible from your environment

## Running Integration Tests

### Local Development (with Docker)

```bash
# Ensure Docker is running
docker ps

# Run integration tests
npm run test:integration
```

### CI/CD (GitHub Actions)

Integration tests run automatically in CI with Docker support:

```yaml
- name: Run integration tests
  run: npm run test:integration
```

### WSL Environment (Limited Docker Support)

If running in WSL without Docker Desktop:

```bash
# Option 1: Install Docker Desktop for Windows with WSL2 backend
# https://docs.docker.com/desktop/install/windows-install/

# Option 2: Use Railway for testing
# Deploy to Railway staging environment and run smoke tests

# Option 3: Skip Testcontainers, use local PostgreSQL
# See alternative test approach below
```

## Alternative: Local PostgreSQL Testing

If Testcontainers isn't available, you can test against a local PostgreSQL instance:

```bash
# 1. Start local PostgreSQL (Docker or native)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=test postgres:15-alpine

# 2. Set DATABASE_URL
export DATABASE_URL=postgresql://postgres:test@localhost:5432/test

# 3. Run migrations manually
npm run migrate:up

# 4. Verify schema
psql $DATABASE_URL -c "\dt whatsapp_handler.*"

# 5. Test rollback
npm run migrate:down
```

## Test Coverage

Integration tests verify:

- ✅ Schema creation (`whatsapp_handler`)
- ✅ Table structure (users, user_preferences, outbox_events)
- ✅ Indexes (7 total, including partial indexes)
- ✅ Constraints (unique, NOT NULL, foreign keys)
- ✅ Cascade deletes (user → preferences)
- ✅ Partial index usage (EXPLAIN plans)
- ✅ Rollback capability (DOWN migration)

## TDD Workflow

Per ADR-014, these tests were written BEFORE the migration:

1. ✅ Write failing tests (this file)
2. ✅ Implement migration (`001_create_whatsapp_handler_schema.ts`)
3. ⏳ Run tests and verify GREEN (requires Docker)
4. ⏳ Refactor if needed

## Production Deployment

Integration tests are **not required** to run in production. They are for:

- Pre-deployment verification (CI/CD)
- Local development confidence
- Migration validation

Railway deployment process:

```bash
# Migrations run automatically during deployment
npm run migrate:up && npm start
```

## Troubleshooting

### "Could not find a working container runtime strategy"

**Cause**: Docker is not running or not accessible.

**Solution**:
1. Start Docker Desktop (Windows/Mac)
2. OR install Docker Engine (Linux)
3. OR use alternative local PostgreSQL approach (see above)

### "Port 5432 already in use"

**Cause**: Another PostgreSQL instance is running.

**Solution**:
```bash
# Stop conflicting PostgreSQL
docker stop $(docker ps -q --filter ancestor=postgres)

# OR use different port in test
container.withExposedPorts(5433)
```

### "Migration file not found"

**Cause**: Migration file path incorrect.

**Solution**:
```bash
# Verify migration exists
ls -la migrations/001_create_whatsapp_handler_schema.ts

# Run from project root
cd /path/to/whatsapp-handler
npm run test:integration
```

## Next Steps

After integration tests pass GREEN:

1. Document results in Phase 2 completion report
2. Hand off to Blake for Phase 3 (service implementation)
3. Blake will add unit tests for business logic
4. Jessie will verify coverage thresholds (Phase 4)
