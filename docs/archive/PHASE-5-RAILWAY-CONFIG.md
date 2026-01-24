# Phase 5: Railway Deployment Configuration - COMPLETE

**Service**: whatsapp-handler
**Repository**: https://github.com/loloatlo/railrepay-whatsapp-handler
**Phase**: 5 (Deployment)
**Owner**: Moykle (DevOps)
**Date**: 2025-12-04
**Status**: ✅ COMPLETE - Ready for Railway Deployment

---

## Summary

Railway deployment configuration is complete and committed to GitHub. The repository is ready for Railway to deploy directly from GitHub.

## What Was Configured

### 1. railway.toml Configuration ✅

**File**: `/railway.toml`

**Changes Made**:
- **Updated builder** from `nixpacks` to `dockerfile`
- Configured to use multi-stage Dockerfile for optimized builds
- Health check configured at `/health` with 100 second timeout
- Restart policy: `on_failure` with 10 max retries
- Internal port: 3000

**Why This Change?**
- **Explicit control**: Dockerfile CMD ensures migrations run before server starts
- **Optimization**: Multi-stage build reduces image size (build deps not in production)
- **Reliability**: Health check includes time for database migrations on first deploy
- **ADR compliance**: Follows ADR-005 (Railway native rollback) and ADR-008 (health checks)

### 2. Documentation Created ✅

#### RAILWAY_SETUP_GUIDE.md (Comprehensive)

**Location**: `/docs/RAILWAY_SETUP_GUIDE.md`

**Contents** (22 sections, 800+ lines):
- Prerequisites checklist
- Step-by-step Railway project setup
- Database & Redis configuration
- Complete environment variable reference
- Build & deploy configuration
- Health check configuration
- Public domain and networking
- Twilio webhook setup
- Grafana Cloud observability integration
- Deployment verification procedures
- Comprehensive troubleshooting guide
- Useful Railway CLI commands
- Support & reference links

#### RAILWAY_QUICK_START.md (Quick Reference)

**Location**: `/docs/RAILWAY_QUICK_START.md`

**Contents** (5-minute setup):
- Prerequisites checklist
- 6-step quick setup procedure
- Configuration files reference
- Quick commands cheat sheet
- Verification checklist
- Common troubleshooting

### 3. Existing Documentation Verified ✅

The following deployment documentation already exists and is comprehensive:

- ✅ `DEPLOYMENT_RUNBOOK.md` - Detailed deployment procedures, rollback, monitoring
- ✅ `RAILWAY_ENVIRONMENT_VARIABLES.md` - Complete environment variable reference
- ✅ `DEPLOYMENT_CHECKLIST.md` - Pre-deployment checklist
- ✅ `SECURITY_SCAN_REPORT.md` - Security audit results

## Railway Configuration Summary

### Build Configuration

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"
```

**Build Process**:
1. Multi-stage Dockerfile build
2. Stage 1 (builder): Install all deps, compile TypeScript
3. Stage 2 (production): Install only prod deps, copy compiled code
4. Result: Optimized production image

### Deploy Configuration

```toml
[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 100
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10
```

**Startup Process**:
1. Railway runs Dockerfile CMD: `npm run migrate:up && npm start`
2. Migrations run first (zero-downtime pattern)
3. Server starts on PORT (Railway-provided)
4. Health check validates service is healthy
5. Railway marks deployment as successful

### Service Configuration

```toml
[service]
internalPort = 3000
```

**Networking**:
- Internal service mesh: `whatsapp-handler.railway.internal:3000`
- Public domain: `<generated>.railway.app` or custom domain
- Health check: HTTP GET `/health` every 30 seconds

## Required Environment Variables

### Railway Auto-Provided ✅

These are automatically injected when you reference PostgreSQL and Redis services:

```bash
DATABASE_URL=postgresql://postgres:password@host:5432/railway
PGHOST=<railway-postgres-host>
PGPORT=5432
PGDATABASE=railway
PGUSER=postgres
PGPASSWORD=<generated>
REDIS_URL=redis://default:password@host:6379
PORT=3000
```

### User Must Configure 🔴

These must be manually set in Railway dashboard:

#### Service Identity (Required)

```bash
SERVICE_NAME=whatsapp-handler
DATABASE_SCHEMA=whatsapp_handler
NODE_ENV=production
LOG_LEVEL=info
```

#### Twilio WhatsApp (Required)

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=<secret - from Twilio console>
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

**Get from**: https://console.twilio.com/

#### Grafana Cloud (Optional - Recommended)

```bash
LOKI_HOST=https://logs-prod-035.grafana.net
LOKI_BASIC_AUTH=<USER_ID>:<API_KEY>
LOKI_ENABLED=true
LOKI_LEVEL=info
ALLOY_PUSH_URL=http://railway-grafana-alloy.railway.internal:9091/api/v1/metrics/write
METRICS_PORT=9090
METRICS_PUSH_INTERVAL=15000
```

**Get from**: https://grafana.com/

## Deployment Steps for User

### Quick Deployment (5 minutes)

Follow `docs/RAILWAY_QUICK_START.md`:

1. **Create Railway Project** (2 min)
   - Go to https://railway.app/dashboard
   - New Project → Deploy from GitHub repo
   - Select: `loloatlo/railrepay-whatsapp-handler`

2. **Add Database & Redis** (1 min)
   - Click "+ New" → Database → PostgreSQL
   - Click "+ New" → Database → Redis
   - Link both to whatsapp-handler service (Variables → "+ Reference")

3. **Set Environment Variables** (2 min)
   - Go to whatsapp-handler → Variables
   - Add required service configuration
   - Add Twilio credentials (mark AUTH_TOKEN as secret)
   - Add optional Grafana Cloud config

4. **Generate Public Domain** (30 sec)
   - Settings → Networking → "Generate Domain"
   - Copy domain: `https://<railway-domain>.railway.app`

5. **Configure Twilio Webhook** (30 sec)
   - Go to https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
   - Set webhook URL: `https://<railway-domain>/webhook/twilio`
   - Method: POST

6. **Deploy & Verify** (auto)
   - Railway auto-deploys on GitHub push
   - Watch logs: `railway logs -s whatsapp-handler --follow`
   - Verify health: `curl https://<railway-domain>/health`

**Result**: Service deployed and operational

### Full Deployment (15 minutes)

Follow `docs/RAILWAY_SETUP_GUIDE.md` for complete step-by-step instructions with:
- Detailed prerequisites
- Comprehensive verification steps
- Grafana Cloud setup
- Smoke test procedures
- Rollback verification

## Verification Checklist

After Railway deployment, verify:

- [ ] **Health check passes**: `curl https://<railway-domain>/health`
  - Expected: `{"status":"healthy","checks":{...}}`

- [ ] **Metrics endpoint works**: `curl https://<railway-domain>/metrics`
  - Expected: Prometheus metrics output

- [ ] **Database migration ran**:
  ```bash
  railway run -s whatsapp-handler psql $DATABASE_URL -c "SELECT * FROM whatsapp_handler.pgmigrations;"
  ```
  - Expected: Migration `001_create_whatsapp_handler_schema` listed

- [ ] **Redis connection works**: Check logs for "Redis connected"
  ```bash
  railway logs -s whatsapp-handler | grep "Redis"
  ```

- [ ] **Twilio webhook receives messages**: Send test WhatsApp message
  ```bash
  railway logs -s whatsapp-handler | grep "webhook"
  ```

- [ ] **No critical errors in logs**:
  ```bash
  railway logs -s whatsapp-handler | grep -i "error\|fatal"
  ```

- [ ] **Smoke tests pass**: `npm run test:smoke` (set SERVICE_URL first)

## ADR Compliance Verification

### ADR-005: Production Deployment Strategy ✅

- ✅ Direct production deployment (no staging)
- ✅ Railway native rollback configured
- ✅ No canary deployments (Railway rollback is safety mechanism)
- ✅ No feature flags (direct deployment)
- ✅ Rollback procedures documented

### ADR-008: Health Check Requirements ✅

- ✅ Health check endpoint: `/health`
- ✅ Returns JSON with status and component checks
- ✅ Includes database, Redis, external service checks
- ✅ 100 second timeout for startup + migrations
- ✅ Railway health check configured in railway.toml

### ADR-010: Smoke Test Requirements ✅

- ✅ Smoke tests defined: `npm run test:smoke`
- ✅ Verification steps documented
- ✅ Rollback procedure if smoke tests fail
- ✅ Smoke tests verify health, metrics, observability

## GitHub Actions CI/CD

**File**: `.github/workflows/ci-cd.yml`

**Pipeline** (verified working):
1. **Test Job**: Lint, build, unit tests, integration tests
2. **Deploy Job**: Notification only (Railway auto-deploys via webhook)

**On Push to Main**:
- GitHub Actions runs tests
- If tests pass, GitHub Actions notifies success
- Railway detects push, pulls code, builds Dockerfile, deploys

**Result**: Continuous deployment on every push to main

## Railway CLI Commands

```bash
# Install CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Link to project (first time)
railway link

# View logs (real-time)
railway logs -s whatsapp-handler --follow

# View environment variables
railway run -s whatsapp-handler env

# Run migrations manually
railway run -s whatsapp-handler npm run migrate:up

# Connect to PostgreSQL
railway run -s whatsapp-handler psql $DATABASE_URL

# Connect to Redis
railway run -s redis redis-cli

# View deployments
railway deployments -s whatsapp-handler

# Rollback to previous deployment
railway rollback <deployment-id>

# Open Railway dashboard
railway open
```

## Common Troubleshooting

### Issue: Health Check Fails After Deployment

**Quick Fix**:
```bash
# Check logs
railway logs -s whatsapp-handler --tail 100

# Verify DATABASE_URL and REDIS_URL
railway run -s whatsapp-handler env | grep -E "DATABASE|REDIS"

# Check PostgreSQL and Redis services are running
railway status
```

### Issue: Migrations Fail During Startup

**Quick Fix**:
```bash
# Check migration logs
railway logs -s whatsapp-handler | grep migration

# Run migrations manually
railway run -s whatsapp-handler npm run migrate:up

# Verify schema exists
railway run -s whatsapp-handler psql $DATABASE_URL -c "\dt whatsapp_handler.*"
```

### Issue: Twilio Webhook Signature Validation Fails

**Quick Fix**:
```bash
# Verify TWILIO_AUTH_TOKEN is correct
railway run -s whatsapp-handler env | grep TWILIO_AUTH_TOKEN

# Check webhook URL in Twilio console
# Must match: https://<railway-domain>/webhook/twilio

# Check signature validation logs
railway logs -s whatsapp-handler | grep signature
```

## Next Phase: Phase 6 (Verification)

After Railway deployment succeeds:

1. **Quinn takes over** for Phase 6 verification
2. **Verify service health**: Health check, metrics, logs
3. **Verify observability**: Grafana Cloud dashboards, alerts
4. **Verify integration**: Twilio webhook, FSM state machine
5. **Document technical debt**: Any deployment issues or shortcuts
6. **Close out**: Complete Phase 6 checklist and close user story

## Files Modified/Created

### Modified
- ✅ `railway.toml` - Updated builder from nixpacks to dockerfile

### Created
- ✅ `docs/RAILWAY_SETUP_GUIDE.md` - Comprehensive Railway setup (800+ lines)
- ✅ `docs/RAILWAY_QUICK_START.md` - Quick reference card (5-minute setup)

### Verified Existing
- ✅ `Dockerfile` - Multi-stage build with migrations
- ✅ `docs/DEPLOYMENT_RUNBOOK.md` - Deployment procedures
- ✅ `docs/RAILWAY_ENVIRONMENT_VARIABLES.md` - Environment variable reference
- ✅ `docs/DEPLOYMENT_CHECKLIST.md` - Pre-deployment checklist
- ✅ `.github/workflows/ci-cd.yml` - GitHub Actions CI/CD

## Git Commit

**Commit**: `ffded23`
**Branch**: `main`
**Pushed to**: https://github.com/loloatlo/railrepay-whatsapp-handler

**Commit Message**:
```
Configure Railway deployment for GitHub integration

- Update railway.toml to use Dockerfile instead of Nixpacks
- Add comprehensive Railway setup guide (RAILWAY_SETUP_GUIDE.md)
- Add quick start reference (RAILWAY_QUICK_START.md)

Changes:
- railway.toml: Switch builder from nixpacks to dockerfile
- Dockerfile CMD handles migrations + server start
- Health check configured at /health with 100s timeout
- Documented complete Railway setup workflow
- Documented environment variables and service configuration
- Documented Twilio webhook and Grafana Cloud integration
- Documented troubleshooting procedures

ADR Compliance:
- ADR-005: Railway native rollback procedures
- ADR-008: Health check endpoint configuration
- ADR-010: Smoke test verification steps

Phase 5 Deliverable: Railway deployment configuration ready
```

## Quality Gate: Phase 5 Complete ✅

### Pre-Deployment (Jessie's QA Sign-Off)
- ✅ All unit tests passing (386/386)
- ✅ Coverage thresholds met: 85% lines, 82% functions, 85% statements, 78% branches
- ✅ Integration tests passing (or documented skip reason)
- ✅ QA sign-off received from Jessie

### Configuration
- ✅ railway.toml updated to use Dockerfile
- ✅ Dockerfile verified with multi-stage build + migrations
- ✅ Health check configured at /health with 100s timeout
- ✅ Restart policy configured: on_failure with 10 retries
- ✅ Environment variables documented

### Documentation
- ✅ Comprehensive setup guide created (RAILWAY_SETUP_GUIDE.md)
- ✅ Quick start reference created (RAILWAY_QUICK_START.md)
- ✅ Existing runbooks verified and referenced
- ✅ Troubleshooting procedures documented
- ✅ Rollback procedures documented per ADR-005

### ADR Compliance
- ✅ ADR-005: Railway native rollback (no canary, no staging)
- ✅ ADR-008: Health check endpoint required
- ✅ ADR-010: Smoke test verification procedures
- ✅ ADR-001: Schema-per-service isolation verified
- ✅ ADR-003: node-pg-migrate for migrations

### GitHub Integration
- ✅ Changes committed to GitHub
- ✅ Changes pushed to main branch
- ✅ GitHub Actions CI/CD verified working
- ✅ Railway can deploy from GitHub repository

## Phase 5 Status: ✅ COMPLETE

**Deliverable**: Railway deployment configuration ready for deployment from GitHub

**Next Step**: User must follow Railway setup guide to create Railway project and deploy

**Handoff**: Ready for Quinn (Phase 6 verification) after Railway deployment succeeds

---

## User Action Required

Follow either:

1. **Quick Setup** (5 minutes): `docs/RAILWAY_QUICK_START.md`
2. **Full Setup** (15 minutes): `docs/RAILWAY_SETUP_GUIDE.md`

After Railway deployment completes:
- Verify health check passes
- Verify Twilio webhook works
- Run smoke tests
- Hand off to Quinn for Phase 6 verification

---

**Phase 5 Complete**: Railway deployment configuration ready ✅
**Owner**: Moykle (DevOps)
**Date**: 2025-12-04
