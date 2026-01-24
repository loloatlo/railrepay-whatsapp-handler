# Deployment Runbook - whatsapp-handler Service

**Service**: whatsapp-handler
**Owner**: Moykle (DevOps)
**Last Updated**: 2025-12-01
**Version**: 1.0.0

## Table of Contents

1. [Overview](#overview)
2. [Pre-Deployment Checklist](#pre-deployment-checklist)
3. [Deployment Procedure](#deployment-procedure)
4. [Post-Deployment Verification](#post-deployment-verification)
5. [Rollback Procedure](#rollback-procedure)
6. [Monitoring and Alerts](#monitoring-and-alerts)
7. [Incident Response](#incident-response)
8. [Troubleshooting Guide](#troubleshooting-guide)

## Overview

This runbook provides step-by-step procedures for deploying the whatsapp-handler service to Railway production environment.

**Deployment Model** (per ADR-005):
- Direct production deployment (NO staging environment)
- Railway native rollback as safety mechanism
- NO canary deployments
- NO feature flags

**Key Characteristics**:
- **Zero-downtime migrations**: Expand-migrate-contract pattern
- **Automatic backups**: Railway PostgreSQL daily backups
- **Health checks**: ADR-008 compliant endpoint at `/health`
- **Observability**: Grafana Cloud metrics, logs, and traces

## Pre-Deployment Checklist

### Phase 4 Sign-Off (BLOCKING)

- [ ] **Jessie's QA sign-off received** (SOP 5.1 - MANDATORY)
  - All unit tests passing (386/386)
  - Integration tests passing (or skipped with documented reason)
  - Coverage thresholds met: ≥80% lines/functions/statements, ≥75% branches
  - No critical bugs in backlog

### Code Quality Gates

- [ ] **All tests passing locally**
  ```bash
  cd /mnt/c/Users/nicbo/Documents/RailRepay\ MVP/services/whatsapp-handler
  npm test
  ```
  Expected: 386 tests passing (integration tests skip in WSL)

- [ ] **TypeScript build succeeds**
  ```bash
  npm run build
  ```
  Expected: No compilation errors, `dist/` directory created

- [ ] **Linting passes**
  ```bash
  npm run lint
  ```
  Expected: No ESLint errors

### Security Verification

- [ ] **No secrets in source code**
  ```bash
  grep -r "TWILIO_AUTH_TOKEN\|API_KEY\|PASSWORD" src/ --exclude="*.test.ts"
  ```
  Expected: No matches (except .env.example)

- [ ] **Dependencies are up to date**
  ```bash
  npm audit
  ```
  Expected: 0 high/critical vulnerabilities

- [ ] **SBOM generated** (will be created by Railway build)

### Database Verification

- [ ] **Migration files have rollback scripts**
  ```bash
  cat migrations/001_create_whatsapp_handler_schema.ts | grep "export async function down"
  ```
  Expected: `down()` function exists with DROP TABLE statements

- [ ] **Migration tested locally with Testcontainers**
  ```bash
  npm run test:integration
  ```
  Expected: Migration tests pass (or skip in WSL with Docker unavailable)

- [ ] **Zero-downtime migration pattern verified**
  - No breaking schema changes (columns dropped, constraints added)
  - If breaking changes exist, expand-migrate-contract plan documented

### Railway Environment

- [ ] **PostgreSQL plugin attached to service**
- [ ] **Redis plugin attached to service**
- [ ] **All environment variables set** (see RAILWAY_ENVIRONMENT_VARIABLES.md)
- [ ] **Secrets stored securely** (TWILIO_AUTH_TOKEN, LOKI_BASIC_AUTH)
- [ ] **Health check path configured**: `/health`
- [ ] **Health check timeout**: 100 seconds (for startup + migrations)

### External Dependencies

- [ ] **Twilio webhook URL updated**: `https://<railway-domain>.railway.app/webhook/twilio`
- [ ] **Grafana Cloud dashboards created**
- [ ] **Grafana Alloy agent deployed and scraping metrics**

## Deployment Procedure

### Step 1: Pre-Deployment Backup

Railway PostgreSQL has automatic daily backups. Verify recent backup exists:

```bash
railway logs -s postgresql --tail 50 | grep "backup"
```

**CRITICAL**: If no recent backup exists, trigger manual backup before proceeding:

```bash
railway backup create -s postgresql
```

### Step 2: Deploy to Railway

Railway auto-deploys on push to `main` branch. To deploy manually:

```bash
# From whatsapp-handler directory
git status
git pull origin main
railway up
```

**Expected output**:
```
Building...
Installing dependencies...
Running migrations...
Starting server...
Health check passed ✓
Deployment successful
```

### Step 3: Monitor Deployment Logs

```bash
railway logs -s whatsapp-handler --tail 100 --follow
```

**Watch for**:
- ✅ "Database pool initialized"
- ✅ "Redis connected"
- ✅ "Handler registry initialized"
- ✅ "whatsapp-handler listening on port 3000"
- ❌ Any ERROR or FATAL log entries

### Step 4: Verify Migrations Ran

```bash
railway run -s whatsapp-handler psql $DATABASE_URL -c "SELECT * FROM whatsapp_handler.pgmigrations ORDER BY id DESC LIMIT 1;"
```

**Expected output**:
```
 id |                name                |         run_on
----+------------------------------------+------------------------
  1 | 001_create_whatsapp_handler_schema | 2025-12-01 01:00:00+00
```

### Step 5: Run Smoke Tests (ADR-010)

```bash
# Set SERVICE_URL to Railway deployment
export SERVICE_URL=https://whatsapp-handler-production.railway.app
npm run test:smoke
```

**Expected**: All smoke tests pass (health check, metrics, observability)

**IF SMOKE TESTS FAIL**: Proceed immediately to [Rollback Procedure](#rollback-procedure)

## Post-Deployment Verification

### Immediate Verification (0-5 minutes)

1. **Health check endpoint**
   ```bash
   curl https://whatsapp-handler-production.railway.app/health
   ```
   Expected: `{"status": "healthy", ...}`

2. **Metrics endpoint**
   ```bash
   curl https://whatsapp-handler-production.railway.app/metrics | head -20
   ```
   Expected: Prometheus metrics output

3. **Database connectivity**
   ```bash
   railway run -s whatsapp-handler psql $DATABASE_URL -c "SELECT COUNT(*) FROM whatsapp_handler.users;"
   ```
   Expected: Query succeeds (returns 0 for new deployment)

4. **Redis connectivity**
   ```bash
   railway logs -s whatsapp-handler | grep "Redis connected"
   ```
   Expected: "Redis connected: redis://..." log entry

### Short-term Monitoring (5-60 minutes)

1. **Monitor Grafana dashboards**
   - Service uptime: Should be 100%
   - HTTP request rate: Should show incoming requests
   - Database query latency: P95 < 1s
   - Redis latency: P95 < 500ms

2. **Check error rates**
   ```bash
   railway logs -s whatsapp-handler --tail 500 | grep -i "error\|fatal\|exception"
   ```
   Expected: No critical errors (warnings acceptable)

3. **Verify Loki logs flowing**
   - Open Grafana Cloud > Explore > Loki
   - Query: `{service="whatsapp-handler"}`
   - Expected: Recent log entries visible

4. **Test Twilio webhook** (if applicable)
   - Send test WhatsApp message to Twilio sandbox number
   - Verify webhook received in Railway logs
   - Verify FSM state machine processes message

### Long-term Monitoring (1-24 hours)

1. **Monitor SLO compliance**
   - Availability: > 99.9%
   - Health check P95: < 100ms
   - Database query P95: < 1s

2. **Check for memory leaks**
   ```bash
   railway metrics -s whatsapp-handler --metric memory
   ```
   Expected: Memory usage stable, not continuously increasing

3. **Review alert notifications**
   - No critical alerts fired
   - Any warnings investigated and documented

## Rollback Procedure

**When to Rollback** (per ADR-005):
- Smoke tests fail after deployment
- Health check endpoint returns unhealthy status
- Critical bug discovered affecting user functionality
- Database migrations cannot be applied
- Service crashes repeatedly (>3 restarts in 5 minutes)

### Railway Native Rollback (Code + Database)

**Step 1: Identify Previous Deployment**

```bash
railway deployments -s whatsapp-handler
```

**Expected output**:
```
ID          STATUS    CREATED AT           COMMIT
dep_xyz123  ACTIVE    2025-12-01 01:00:00  abc1234 (current - BAD)
dep_abc789  SUCCESS   2025-11-30 12:00:00  def5678 (previous - GOOD)
```

**Step 2: Execute Rollback**

```bash
# Rollback to previous deployment
railway rollback dep_abc789
```

**Step 3: Rollback Database Migration**

```bash
# Connect to Railway PostgreSQL
railway run -s whatsapp-handler npm run migrate:down
```

**CRITICAL**: Only rollback migrations if:
1. Migration has not been live for >1 hour
2. No user data has been written to new tables
3. Down migration script has been tested

**Step 4: Restore Database Backup (if needed)**

```bash
# List available backups
railway backup list -s postgresql

# Restore specific backup
railway backup restore <backup-id> -s postgresql
```

**WARNING**: Backup restoration will cause downtime. Coordinate with stakeholders.

### Verification After Rollback

1. **Confirm service is running**
   ```bash
   curl https://whatsapp-handler-production.railway.app/health
   ```
   Expected: `{"status": "healthy"}`

2. **Verify previous version deployed**
   ```bash
   railway logs -s whatsapp-handler | grep "version"
   ```
   Expected: Previous version number

3. **Check database schema**
   ```bash
   railway run -s whatsapp-handler psql $DATABASE_URL -c "\dt whatsapp_handler.*"
   ```
   Expected: Previous schema state

4. **Run smoke tests**
   ```bash
   npm run test:smoke
   ```
   Expected: All tests pass

### Post-Rollback Actions

1. **Document rollback reason**
   - Create incident report
   - Document root cause
   - Add to technical debt backlog

2. **Notify stakeholders**
   - Alert team in Slack/Discord
   - Update status page if applicable

3. **Fix and redeploy**
   - Address root cause
   - Re-run full deployment checklist
   - Deploy during low-traffic window

## Monitoring and Alerts

### Grafana Cloud Dashboards

1. **whatsapp-handler Service Overview**
   - URL: https://railrepay.grafana.net/d/whatsapp-handler
   - Metrics: Uptime, request rate, error rate, latency

2. **Database Performance**
   - Query latency histogram
   - Connection pool utilization
   - Transaction throughput

3. **Redis Performance**
   - Cache hit rate
   - FSM state transitions
   - Key expiration rate

### Alert Rules

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| Service Down | Health check fails >3 times in 5 min | Critical | Page on-call engineer |
| High Error Rate | Error rate > 5% for 10 min | Critical | Investigate logs immediately |
| Database Slow | P95 query latency > 1s for 5 min | High | Check database performance |
| Memory Leak | Memory usage increases >20% over 1 hour | Medium | Check for memory leaks |
| Redis Down | Redis unavailable for >1 min | High | Restart Redis, verify connection |

### Log Queries (Grafana Loki)

```logql
# All errors in last hour
{service="whatsapp-handler"} |= "error" | json | __error__=""

# Database connection errors
{service="whatsapp-handler"} |~ "database.*error" | json

# Twilio webhook failures
{service="whatsapp-handler"} | json | webhook_status="failure"

# Slow queries (>500ms)
{service="whatsapp-handler"} | json | duration_ms > 500
```

## Incident Response

### Severity Levels

- **P0 (Critical)**: Service completely down, affects all users
- **P1 (High)**: Major functionality broken, affects >50% users
- **P2 (Medium)**: Minor functionality broken, affects <50% users
- **P3 (Low)**: Performance degradation, no user impact

### Response Procedures

#### P0: Service Down

1. **Immediate actions** (0-5 min)
   - Check Railway deployment status
   - Check health endpoint
   - Review recent logs for fatal errors

2. **Diagnosis** (5-15 min)
   - Identify root cause (code, database, dependencies)
   - Check external service status (Twilio, Redis)

3. **Resolution** (15-30 min)
   - Execute rollback if recent deployment
   - Restart service if transient failure
   - Scale up if resource exhaustion

4. **Communication**
   - Update status page
   - Notify stakeholders every 15 minutes

#### P1: Major Functionality Broken

1. **Triage** (0-10 min)
   - Identify affected functionality
   - Determine user impact scope

2. **Workaround** (10-30 min)
   - Deploy hotfix if possible
   - Document workaround for users

3. **Root cause fix** (1-4 hours)
   - Develop permanent fix
   - Test thoroughly
   - Deploy during low-traffic window

## Troubleshooting Guide

### Issue: Deployment Fails at Build Stage

**Symptoms**: Railway build fails with npm error

**Diagnosis**:
```bash
railway logs -s whatsapp-handler --deployment <deployment-id>
```

**Common Causes**:
- Missing dependency in package.json
- TypeScript compilation error
- Node version mismatch

**Solution**:
1. Verify package.json includes all dependencies
2. Test build locally: `npm run build`
3. Check Node version matches package.json engines field

### Issue: Migration Fails During Deployment

**Symptoms**: Service crashes on startup, logs show migration error

**Diagnosis**:
```bash
railway logs -s whatsapp-handler | grep "migration"
```

**Common Causes**:
- Database connection timeout
- Schema already exists
- Migration syntax error

**Solution**:
1. Check DATABASE_URL is set correctly
2. Verify PostgreSQL is accessible
3. Test migration locally with Testcontainers
4. Rollback and fix migration script

### Issue: Health Check Fails After Deployment

**Symptoms**: Railway marks deployment as unhealthy

**Diagnosis**:
```bash
curl https://whatsapp-handler-production.railway.app/health
railway logs -s whatsapp-handler | tail -50
```

**Common Causes**:
- Database not responding
- Redis not responding
- Health check timeout too short

**Solution**:
1. Verify DATABASE_URL and REDIS_URL are set
2. Check PostgreSQL and Redis plugins are attached
3. Increase health check timeout to 100 seconds
4. Check for error logs during startup

### Issue: Twilio Webhook Signature Validation Fails

**Symptoms**: All webhook requests return 403 Forbidden

**Diagnosis**:
```bash
railway logs -s whatsapp-handler | grep "signature"
```

**Common Causes**:
- Incorrect TWILIO_AUTH_TOKEN
- Webhook URL mismatch
- Railway proxy modifying request headers

**Solution**:
1. Verify TWILIO_AUTH_TOKEN matches Twilio console
2. Ensure webhook URL in Twilio uses https://
3. Check Railway logs for exact signature validation error

### Issue: Redis Connection Timeout

**Symptoms**: FSM state transitions fail, Redis health check unhealthy

**Diagnosis**:
```bash
railway logs -s whatsapp-handler | grep "Redis"
railway logs -s redis
```

**Common Causes**:
- Redis plugin not attached
- REDIS_URL incorrect
- Redis out of memory

**Solution**:
1. Verify Redis plugin attached to service
2. Check REDIS_URL format: `redis://...`
3. Check Redis memory usage in Railway dashboard
4. Restart Redis if necessary

## Release Notes Template

Use this template for every deployment:

```markdown
# whatsapp-handler v1.0.0 - 2025-12-01

## Summary
Brief description of changes in this release.

## Changes
- Feature: New functionality added
- Fix: Bug fixed
- Refactor: Code improvement

## Database Migrations
- Migration 001: Create whatsapp_handler schema
  - Tables: users, user_preferences, outbox_events
  - Zero-downtime: Yes
  - Rollback tested: Yes

## Testing
- Unit tests: 386/386 passing
- Integration tests: Skipped (WSL Docker limitation)
- Smoke tests: All passing
- Coverage: 85% lines, 82% functions, 85% statements, 78% branches

## Deployment
- Deployed by: Moykle
- Deployment time: 2025-12-01 01:00:00 UTC
- Downtime: 0 seconds
- Rollback plan: Railway native rollback + migrate:down

## Monitoring
- Dashboard: https://railrepay.grafana.net/d/whatsapp-handler
- Alerts: No critical alerts fired
- SLO compliance: 100% availability

## Known Issues
- None

## Dependencies
- No external dependency changes
```

## Appendix

### Useful Commands

```bash
# Check deployment status
railway status -s whatsapp-handler

# View real-time logs
railway logs -s whatsapp-handler --follow

# Run database query
railway run -s whatsapp-handler psql $DATABASE_URL -c "SELECT COUNT(*) FROM whatsapp_handler.users;"

# Execute migrations
railway run -s whatsapp-handler npm run migrate:up

# Rollback migrations
railway run -s whatsapp-handler npm run migrate:down

# Open Railway dashboard
railway open -s whatsapp-handler

# Connect to PostgreSQL shell
railway run -s whatsapp-handler psql $DATABASE_URL

# Connect to Redis CLI
railway run -s redis redis-cli

# View metrics
railway metrics -s whatsapp-handler --metric cpu,memory,network
```

### Emergency Contacts

- **On-call DevOps**: Moykle
- **Service Owner**: Blake (Backend Engineer)
- **QA Lead**: Jessie
- **Railway Support**: https://railway.app/help
- **Twilio Support**: https://support.twilio.com/

### References

- ADR-005: Production Deployment Strategy (Railway native rollback)
- ADR-008: Health Check Requirements
- ADR-010: Smoke Test Requirements
- Infrastructure & Deployment Notion page
- RAILWAY_ENVIRONMENT_VARIABLES.md
