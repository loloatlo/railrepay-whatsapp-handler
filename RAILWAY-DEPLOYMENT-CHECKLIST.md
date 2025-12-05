# Railway Deployment Checklist - whatsapp-handler

## Pre-Deployment Verification

### Code Changes
- [x] package.json: migrate:up and migrate:down use explicit `--migrations-dir dist/migrations`
- [x] Dockerfile: Cache bust updated to v4-migrations-fix
- [x] Compiled migrations exist in dist/migrations/
- [x] Build completes successfully: `npm run build`

### Railway Configuration
- [ ] Service: whatsapp-handler exists in Railway project
- [ ] Dockerfile deployment method selected (not Nixpacks)
- [ ] Environment variables configured:
  - [ ] PGUSER
  - [ ] PGPASSWORD
  - [ ] PGHOST
  - [ ] PGPORT (default: 5432)
  - [ ] PGDATABASE
  - [ ] NODE_TLS_REJECT_UNAUTHORIZED=0 (for self-signed certs)
  - [ ] PORT (Railway auto-sets)
  - [ ] NODE_ENV=production
  - [ ] REDIS_URL (from Railway Redis service)

### Database
- [ ] Shared PostgreSQL instance provisioned on Railway
- [ ] Schema `whatsapp_handler` will be created by first migration
- [ ] Database credentials match environment variables
- [ ] SSL enabled with self-signed certificate (NODE_TLS_REJECT_UNAUTHORIZED=0 handles this)

## Deployment Execution

### Step 1: Commit and Push
```bash
git add package.json Dockerfile docs/RAILWAY-MIGRATION-FIX.md
git commit -m "fix: explicit migrations-dir flag for Railway deployment

- Add --migrations-dir dist/migrations to migrate:up/down scripts
- Resolves node-pg-migrate config path resolution in containers
- Update Dockerfile cache bust to v4-migrations-fix
- Document fix in RAILWAY-MIGRATION-FIX.md

Closes: Railway deployment migration path error"

git push origin main
```

### Step 2: Railway Automatic Deployment
Railway will automatically:
1. Detect Dockerfile in repository
2. Build multi-stage image
3. Run CMD: migrations → start server
4. Expose service on Railway domain

### Step 3: Monitor Deployment Logs
Watch Railway logs for:
```
Building Dockerfile...
[Build stage] Installing dependencies
[Build stage] Compiling TypeScript
[Production stage] Installing production dependencies
[Production stage] Running migrations
Migrating 001_create_whatsapp_handler_schema up...
Migration complete
Server listening on port 3000
Health check: OK
```

### Step 4: Verify Migration Success
Check database:
```sql
SELECT * FROM whatsapp_handler.pgmigrations;
-- Should show: 001_create_whatsapp_handler_schema

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'whatsapp_handler';
-- Should show: users, conversations, messages, pgmigrations
```

## Post-Deployment Validation (ADR-010 Smoke Tests)

### Health Check
```bash
curl https://whatsapp-handler-production.up.railway.app/health
# Expected: {"status":"healthy","timestamp":"...","service":"whatsapp-handler"}
```

### Metrics Endpoint
```bash
curl https://whatsapp-handler-production.up.railway.app/metrics
# Expected: Prometheus format metrics
```

### API Endpoints (requires valid Twilio signature)
- POST /webhook - WhatsApp message webhook
- GET /health - Health check
- GET /metrics - Prometheus metrics

## Rollback Procedure (ADR-005)

If deployment fails:

### 1. Railway Native Rollback (Code)
```bash
# In Railway dashboard:
# 1. Go to whatsapp-handler service
# 2. Click "Deployments" tab
# 3. Find last working deployment
# 4. Click "Redeploy"
```

### 2. Database Rollback (If Migration Applied)
```bash
# Connect to Railway PostgreSQL
DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require" \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
npm run migrate:down
```

### 3. Verify Rollback
```bash
# Check service health
curl https://whatsapp-handler-production.up.railway.app/health

# Verify database state
psql $DATABASE_URL -c "SELECT * FROM whatsapp_handler.pgmigrations;"
```

## Success Criteria

- [ ] Railway build completes without errors
- [ ] Migration applies successfully (001_create_whatsapp_handler_schema)
- [ ] Service starts and passes health check
- [ ] Health endpoint returns 200 OK
- [ ] Metrics endpoint returns Prometheus format
- [ ] No error logs in Railway console
- [ ] Database schema `whatsapp_handler` exists with all tables
- [ ] pgmigrations table shows applied migration

## Common Issues

### Issue: "ENOENT: no such file or directory, scandir '/app/migrations/'"
**Status:** RESOLVED by explicit --migrations-dir flag
**Solution:** Already implemented in package.json

### Issue: "self signed certificate in certificate chain"
**Status:** RESOLVED by NODE_TLS_REJECT_UNAUTHORIZED=0
**Solution:** Set in Dockerfile CMD and Railway env vars

### Issue: "relation does not exist"
**Cause:** Migration didn't run or failed
**Solution:** Check Railway logs, verify DATABASE_URL construction, manually run migration

### Issue: Health check fails
**Cause:** Port mismatch or service not starting
**Solution:** Verify Railway sets PORT env var, check server binds to process.env.PORT

## Monitoring Setup (Post-Deployment)

### Grafana Cloud (per Observability Notion page)
- [ ] Configure Grafana Alloy agent to scrape metrics endpoint
- [ ] Create dashboard showing:
  - Request rate (HTTP requests/sec)
  - Error rate (5xx responses)
  - Latency (p50, p95, p99)
  - Database connection pool status
  - Redis cache hit rate
- [ ] Set up alerts:
  - Health check fails for 5 minutes
  - Error rate > 5%
  - Latency p95 > 2 seconds

### Railway Logs
- [ ] Configure log retention
- [ ] Set up log forwarding to Grafana Loki (via Alloy)
- [ ] Verify correlation IDs appear in logs (ADR-002)

## Documentation Updates

- [x] RAILWAY-MIGRATION-FIX.md - Technical details of fix
- [x] RAILWAY-DEPLOYMENT-CHECKLIST.md - This file
- [ ] Update PHASE-5-RAILWAY-CONFIG.md - Add migration fix notes
- [ ] Update TECHNICAL-DEBT-REGISTER.md - Mark SSL workaround as tracked

## Sign-Off

Deployment authorized by: ___________________
Date: ___________________
Jessie QA Sign-off received: [ ] Yes [ ] No
Rollback procedures tested: [ ] Yes [ ] No
Monitoring configured: [ ] Yes [ ] No

---

**Next Steps After Successful Deployment:**
Hand off to Quinn for Phase 6 verification and closeout.
