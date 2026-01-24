# Railway Setup Guide - whatsapp-handler

**Service**: whatsapp-handler
**Repository**: https://github.com/loloatlo/railrepay-whatsapp-handler
**Owner**: Moykle (DevOps)
**Last Updated**: 2025-12-04
**Version**: 1.0.0

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Railway Project Setup](#railway-project-setup)
3. [Database & Redis Configuration](#database--redis-configuration)
4. [Environment Variables](#environment-variables)
5. [Build & Deploy Configuration](#build--deploy-configuration)
6. [Health Check Configuration](#health-check-configuration)
7. [Networking & Domain](#networking--domain)
8. [Twilio Webhook Configuration](#twilio-webhook-configuration)
9. [Grafana Cloud Observability](#grafana-cloud-observability)
10. [Deployment Verification](#deployment-verification)
11. [Troubleshooting](#troubleshooting)

## Prerequisites

Before setting up Railway deployment, ensure:

- [ ] GitHub repository exists: `loloatlo/railrepay-whatsapp-handler`
- [ ] Repository is public or Railway has access via GitHub OAuth
- [ ] Railway account created: https://railway.app/
- [ ] Railway CLI installed (optional): `npm install -g @railway/cli`
- [ ] Twilio account created for WhatsApp sandbox
- [ ] Grafana Cloud account created for observability (optional but recommended)

## Railway Project Setup

### Step 1: Create New Railway Project

1. Go to https://railway.app/dashboard
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose **"loloatlo/railrepay-whatsapp-handler"**
5. Railway will create a new project and service

**Expected Result**: Railway creates a project named "railrepay-whatsapp-handler" with one service.

### Step 2: Service Configuration

1. Click on the newly created service
2. Go to **Settings** tab
3. Configure the following:

**Service Name**: `whatsapp-handler` (or keep Railway's default)

**Root Directory**: `/` (default - repository root)

**Builder**: Railway should auto-detect the Dockerfile via `railway.toml`

**Auto-Deploy**:
- ✅ Enable auto-deploy on push to `main` branch
- Railway will redeploy automatically when you push to GitHub

**Expected Result**: Service settings show "Dockerfile" as builder and auto-deploy enabled.

### Step 3: Verify railway.toml Detection

Railway reads the `railway.toml` file in the repository root to configure build and deploy settings.

**Verify Configuration**:
```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 100
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10

[service]
internalPort = 3000
```

**Expected Result**: Railway dashboard shows these settings applied automatically.

## Database & Redis Configuration

### Step 4: Add PostgreSQL Database

1. In your Railway project, click **"+ New"**
2. Select **"Database" → "PostgreSQL"**
3. Railway provisions a PostgreSQL 16 instance
4. Click on the PostgreSQL service
5. Go to **"Variables"** tab
6. Copy the `DATABASE_URL` value

**Railway Auto-Provides**:
- `DATABASE_URL`: Full connection string (e.g., `postgresql://postgres:password@host:5432/railway`)
- `PGHOST`: PostgreSQL host
- `PGPORT`: PostgreSQL port (5432)
- `PGDATABASE`: Database name (railway)
- `PGUSER`: Database user (postgres)
- `PGPASSWORD`: Database password

**IMPORTANT**: Railway automatically injects these variables into your whatsapp-handler service when you reference the PostgreSQL database.

### Step 5: Add Redis Instance

1. In your Railway project, click **"+ New"**
2. Select **"Database" → "Redis"**
3. Railway provisions a Redis 7 instance
4. Click on the Redis service
5. Go to **"Variables"** tab
6. Copy the `REDIS_URL` value

**Railway Auto-Provides**:
- `REDIS_URL`: Full connection string (e.g., `redis://default:password@host:6379`)

**Expected Result**: PostgreSQL and Redis services appear in your project alongside whatsapp-handler.

### Step 6: Link Services to whatsapp-handler

1. Click on the **whatsapp-handler** service
2. Go to **"Variables"** tab
3. Click **"+ Reference"**
4. Select **PostgreSQL** service → Add all variables
5. Click **"+ Reference"** again
6. Select **Redis** service → Add all variables

**Expected Result**: `DATABASE_URL` and `REDIS_URL` appear in whatsapp-handler's environment variables.

## Environment Variables

### Step 7: Set Required Service Configuration

In the whatsapp-handler service's **Variables** tab, add the following **Raw Variables**:

#### Service Identity

```bash
SERVICE_NAME=whatsapp-handler
DATABASE_SCHEMA=whatsapp_handler
NODE_ENV=production
LOG_LEVEL=info
PORT=3000
```

**Note**: Railway auto-provides `PORT` but setting it explicitly ensures consistency.

#### Twilio WhatsApp Integration (REQUIRED)

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

**Security**: Store `TWILIO_AUTH_TOKEN` as a secret variable. Click the lock icon next to the variable to mark it as secret.

**Where to Get These**:
1. Go to https://console.twilio.com/
2. Copy **Account SID** from dashboard
3. Copy **Auth Token** from dashboard (click "Show" to reveal)
4. For sandbox testing, use: `whatsapp:+14155238886`
5. For production, apply for WhatsApp Business API access

### Step 8: Set Optional Observability Variables (Recommended)

If using Grafana Cloud for monitoring:

```bash
# Grafana Loki (Logs)
LOKI_HOST=https://logs-prod-035.grafana.net
LOKI_BASIC_AUTH=<USER_ID>:<API_KEY>
LOKI_ENABLED=true
LOKI_LEVEL=info

# Grafana Alloy (Metrics)
ALLOY_PUSH_URL=http://railway-grafana-alloy.railway.internal:9091/api/v1/metrics/write
METRICS_PORT=9090
METRICS_PUSH_INTERVAL=15000
```

**Where to Get These**:
1. Sign up at https://grafana.com/auth/sign-up/create-user
2. Go to **Settings → API Keys** → Create new key (MetricsPublisher, LogsPublisher roles)
3. Copy **Loki URL** from **Connections → Data Sources → Loki**
4. Format `LOKI_BASIC_AUTH` as `<USER_ID>:<API_KEY>`

**Note**: Grafana Alloy agent should be deployed as a separate Railway service for metrics collection.

### Step 9: Set Optional External Service URLs

If timetable-loader service is deployed:

```bash
TIMETABLE_LOADER_URL=http://timetable-loader.railway.internal
```

**Note**: Railway provides internal networking via `.railway.internal` domain for service-to-service communication.

### Environment Variable Checklist

Before proceeding, verify all required variables are set:

- [ ] `SERVICE_NAME=whatsapp-handler`
- [ ] `DATABASE_SCHEMA=whatsapp_handler`
- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` (auto-provided by PostgreSQL reference)
- [ ] `REDIS_URL` (auto-provided by Redis reference)
- [ ] `TWILIO_ACCOUNT_SID` (from Twilio console)
- [ ] `TWILIO_AUTH_TOKEN` (from Twilio console, marked as secret)
- [ ] `TWILIO_WHATSAPP_NUMBER` (sandbox or production number)
- [ ] Optional: Grafana Cloud observability variables

## Build & Deploy Configuration

### Step 10: Verify Build Settings

Railway reads build configuration from `railway.toml`. No manual configuration needed in the Railway dashboard.

**Verify in Settings Tab**:
- **Builder**: Dockerfile
- **Dockerfile Path**: Dockerfile
- **Build Command**: (empty - Dockerfile handles it)
- **Start Command**: (empty - Dockerfile CMD handles it)

**Dockerfile CMD**:
```dockerfile
CMD ["sh", "-c", "npm run migrate:up && npm start"]
```

This ensures database migrations run before the server starts.

**Expected Result**: Railway builds using the Dockerfile automatically.

## Health Check Configuration

### Step 11: Configure Health Check

Railway reads health check configuration from `railway.toml`. Verify in **Settings → Deploy**:

**Health Check Path**: `/health`

**Health Check Timeout**: `100` seconds

**Restart Policy**: `on_failure` with `10` max retries

**Why 100 seconds?**
- Database connection establishment: ~10s
- Redis connection: ~5s
- Database migrations (on first deploy): ~20-60s
- Service initialization: ~5s
- Total: Up to 100s for cold starts

**Health Check Endpoint Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-04T00:00:00.000Z",
  "version": "1.0.0",
  "checks": {
    "database": {
      "status": "healthy",
      "latency_ms": 15
    },
    "redis": {
      "status": "healthy",
      "latency_ms": 8
    },
    "timetable_loader": {
      "status": "healthy",
      "latency_ms": 45
    }
  }
}
```

**Expected Result**: Railway marks deployment as healthy only when `/health` returns 200 status.

## Networking & Domain

### Step 12: Enable Public Networking

1. Go to whatsapp-handler service **Settings**
2. Scroll to **Networking** section
3. Click **"Generate Domain"**
4. Railway provides a public URL like: `whatsapp-handler-production.up.railway.app`

**Expected Result**: Service is accessible publicly via HTTPS.

### Step 13: Custom Domain (Optional)

If you have a custom domain:

1. Go to **Settings → Networking → Custom Domain**
2. Enter your domain: `api.railrepay.com`
3. Railway provides DNS records (CNAME)
4. Add CNAME record to your DNS provider:
   ```
   api.railrepay.com CNAME whatsapp-handler-production.up.railway.app
   ```
5. Wait for DNS propagation (5-60 minutes)

**Expected Result**: Service accessible via custom domain with automatic SSL certificate.

## Twilio Webhook Configuration

### Step 14: Configure Twilio Webhook URL

After Railway generates your public domain, configure Twilio to send WhatsApp messages to your service:

1. Go to https://console.twilio.com/
2. Navigate to **Messaging → Try it out → Send a WhatsApp message**
3. Click **"WhatsApp Sandbox Settings"**
4. Set **"When a message comes in"** webhook URL:
   ```
   https://<railway-domain>/webhook/twilio
   ```
   Example: `https://whatsapp-handler-production.up.railway.app/webhook/twilio`
5. Set HTTP method: **POST**
6. Save configuration

**For Production** (after WhatsApp Business API approval):
1. Go to **Messaging → WhatsApp → Senders**
2. Select your WhatsApp number
3. Configure webhook URL: `https://<railway-domain>/webhook/twilio`
4. Enable signature validation

**Expected Result**: Twilio sends incoming WhatsApp messages to your Railway deployment.

### Step 15: Test Twilio Webhook

1. Send a WhatsApp message to your Twilio sandbox number (e.g., `+1 415 523 8886`)
2. Check Railway logs:
   ```bash
   railway logs -s whatsapp-handler --tail 50
   ```
3. Look for:
   ```
   Received Twilio webhook: { From: 'whatsapp:+447700900123', Body: 'Hello' }
   ```

**Expected Result**: Webhook received and processed successfully.

## Grafana Cloud Observability

### Step 16: Deploy Grafana Alloy Agent (Optional)

For metrics collection, deploy Grafana Alloy as a separate Railway service:

1. In your Railway project, click **"+ New"**
2. Select **"Empty Service"**
3. Name it: `railway-grafana-alloy`
4. Deploy Grafana Alloy Docker image:
   ```
   grafana/alloy:latest
   ```
5. Configure Alloy to scrape whatsapp-handler's `/metrics` endpoint
6. Configure Alloy to push to Grafana Cloud Prometheus

**Alloy Configuration** (alloy-config.river):
```hcl
prometheus.scrape "whatsapp_handler" {
  targets = [{
    __address__ = "whatsapp-handler.railway.internal:9090",
  }]
  forward_to = [prometheus.remote_write.grafana.receiver]
}

prometheus.remote_write "grafana" {
  endpoint {
    url = "https://prometheus-prod-035.grafana.net/api/prom/push"
    basic_auth {
      username = "<USER_ID>"
      password = "<API_KEY>"
    }
  }
}
```

**Note**: This is an advanced configuration. See Grafana Alloy documentation for details.

### Step 17: Create Grafana Dashboards

1. Log in to Grafana Cloud: https://grafana.com/
2. Go to **Dashboards → New Dashboard**
3. Add panels for key metrics:
   - HTTP request rate: `rate(http_requests_total[5m])`
   - Health check latency: `histogram_quantile(0.95, health_check_duration_seconds)`
   - Database query latency: `histogram_quantile(0.95, db_query_duration_seconds)`
   - Redis latency: `histogram_quantile(0.95, redis_operation_duration_seconds)`
4. Save dashboard as: **whatsapp-handler Service Overview**

**Expected Result**: Metrics flowing from Railway to Grafana Cloud.

## Deployment Verification

### Step 18: Trigger Initial Deployment

If auto-deploy is enabled, Railway deploys automatically when you push to `main` branch.

**To trigger manual deployment**:
1. Go to Railway dashboard
2. Click on whatsapp-handler service
3. Go to **Deployments** tab
4. Click **"Deploy Now"**

**Monitor Deployment**:
```bash
railway logs -s whatsapp-handler --follow
```

**Watch for**:
1. **Build stage**:
   - `Building Dockerfile...`
   - `Step 1/12: FROM node:20-alpine AS builder`
   - `Step 12/12: CMD ["sh", "-c", "npm run migrate:up && npm start"]`
2. **Deployment stage**:
   - `Running migrations...`
   - `Migration 001_create_whatsapp_handler_schema UP`
   - `Database pool initialized`
   - `Redis connected`
   - `whatsapp-handler listening on port 3000`
3. **Health check**:
   - `Health check passed ✓`
   - `Deployment successful`

### Step 19: Verify Health Check

```bash
curl https://<railway-domain>/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-04T00:00:00.000Z",
  "version": "1.0.0",
  "checks": {
    "database": {
      "status": "healthy",
      "latency_ms": 15
    },
    "redis": {
      "status": "healthy",
      "latency_ms": 8
    }
  }
}
```

### Step 20: Verify Metrics Endpoint

```bash
curl https://<railway-domain>/metrics | head -20
```

**Expected Response** (Prometheus format):
```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/health",status="200"} 42

# HELP health_check_duration_seconds Health check duration
# TYPE health_check_duration_seconds histogram
health_check_duration_seconds_bucket{le="0.1"} 38
health_check_duration_seconds_bucket{le="0.5"} 42
...
```

### Step 21: Verify Database Migrations

```bash
railway run -s whatsapp-handler psql $DATABASE_URL -c "SELECT * FROM whatsapp_handler.pgmigrations;"
```

**Expected Response**:
```
 id |                name                |         run_on
----+------------------------------------+------------------------
  1 | 001_create_whatsapp_handler_schema | 2025-12-04 00:00:00+00
```

### Step 22: Run Smoke Tests

From your local machine:

```bash
cd /mnt/c/Users/nicbo/Documents/RailRepay\ MVP/services/whatsapp-handler
export SERVICE_URL=https://<railway-domain>
npm run test:smoke
```

**Expected Result**: All smoke tests pass.

**IF SMOKE TESTS FAIL**: Execute Railway rollback immediately:
```bash
railway rollback <previous-deployment-id>
```

## Troubleshooting

### Issue: Build Fails with "Cannot find Dockerfile"

**Cause**: Railway cannot locate the Dockerfile.

**Solution**:
1. Verify `railway.toml` has `dockerfilePath = "Dockerfile"`
2. Verify Dockerfile exists in repository root
3. Push changes to GitHub and redeploy

### Issue: Health Check Fails After Deployment

**Symptoms**: Railway marks deployment as unhealthy.

**Diagnosis**:
```bash
railway logs -s whatsapp-handler --tail 100 | grep -i "error\|health"
```

**Common Causes**:
1. Database connection timeout
   - **Solution**: Verify `DATABASE_URL` is set and PostgreSQL service is running
2. Redis connection timeout
   - **Solution**: Verify `REDIS_URL` is set and Redis service is running
3. Health check timeout too short
   - **Solution**: Already set to 100s in railway.toml

### Issue: Migration Fails During Startup

**Symptoms**: Service crashes on startup with migration error.

**Diagnosis**:
```bash
railway logs -s whatsapp-handler | grep "migration"
```

**Common Causes**:
1. Schema already exists
   - **Solution**: Migrations are idempotent, check migration logic
2. Database connection timeout
   - **Solution**: Increase `DATABASE_URL` connection timeout parameter
3. Migration syntax error
   - **Solution**: Test migration locally before deploying

### Issue: Twilio Webhook Signature Validation Fails

**Symptoms**: All webhook requests return 403 Forbidden.

**Diagnosis**:
```bash
railway logs -s whatsapp-handler | grep "signature"
```

**Common Causes**:
1. Incorrect `TWILIO_AUTH_TOKEN`
   - **Solution**: Copy auth token from Twilio console exactly
2. Webhook URL mismatch
   - **Solution**: Verify webhook URL in Twilio matches Railway domain
3. Railway proxy modifying headers
   - **Solution**: Check Railway logs for exact header values received

### Issue: Environment Variables Not Loaded

**Symptoms**: Service crashes with "Missing required environment variable".

**Diagnosis**:
```bash
railway run -s whatsapp-handler env | grep TWILIO
```

**Solution**:
1. Go to Railway dashboard → whatsapp-handler → Variables
2. Verify all required variables are set
3. Redeploy service to pick up new variables

### Issue: Service Crashes After Deployment

**Symptoms**: Deployment succeeds but service immediately crashes.

**Diagnosis**:
```bash
railway logs -s whatsapp-handler --tail 100
```

**Common Causes**:
1. Unhandled exception in startup code
   - **Solution**: Check logs for stack trace, fix bug, redeploy
2. Missing dependencies
   - **Solution**: Verify package.json includes all dependencies
3. Port mismatch
   - **Solution**: Ensure service listens on `process.env.PORT`

## Next Steps

After successful Railway deployment:

1. **Monitor for 1 hour**:
   - Watch Railway logs for errors
   - Check Grafana dashboards for anomalies
   - Verify Twilio webhooks are being received

2. **Configure Alerts**:
   - Set up Grafana alerts for critical metrics
   - Configure PagerDuty/OpsGenie integration
   - Test alert firing and notification delivery

3. **Document Runbooks**:
   - Update `DEPLOYMENT_RUNBOOK.md` with Railway-specific procedures
   - Document rollback procedures
   - Create incident response playbooks

4. **Security Hardening**:
   - Rotate Twilio auth token
   - Enable Railway SSO for team access
   - Audit environment variable access logs

5. **Performance Tuning**:
   - Monitor resource usage (CPU, memory, network)
   - Adjust Railway scaling policies if needed
   - Optimize database queries based on metrics

## Useful Commands

### Railway CLI

```bash
# Login to Railway
railway login

# Link to project
railway link

# View logs
railway logs -s whatsapp-handler --follow

# View environment variables
railway run -s whatsapp-handler env

# Execute command in Railway environment
railway run -s whatsapp-handler npm run migrate:up

# Connect to PostgreSQL
railway run -s whatsapp-handler psql $DATABASE_URL

# Connect to Redis
railway run -s redis redis-cli

# View deployments
railway deployments -s whatsapp-handler

# Rollback to previous deployment
railway rollback <deployment-id>

# View service status
railway status -s whatsapp-handler

# Open Railway dashboard
railway open
```

### Health Check & Debugging

```bash
# Check health endpoint
curl https://<railway-domain>/health | jq

# Check metrics endpoint
curl https://<railway-domain>/metrics | grep http_requests

# Test Twilio webhook locally
curl -X POST https://<railway-domain>/webhook/twilio \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "MessageSid=SM123&From=whatsapp:+447700900123&To=whatsapp:+14155238886&Body=Hello"
```

## Support & References

### Railway Documentation
- Railway Docs: https://docs.railway.app/
- Railway CLI: https://docs.railway.app/develop/cli
- Railway Discord: https://discord.gg/railway

### Twilio Documentation
- WhatsApp API: https://www.twilio.com/docs/whatsapp
- Webhook Configuration: https://www.twilio.com/docs/usage/webhooks
- Twilio Support: https://support.twilio.com/

### Grafana Cloud Documentation
- Grafana Docs: https://grafana.com/docs/
- Grafana Alloy: https://grafana.com/docs/alloy/
- Grafana Support: support@grafana.com

### RailRepay Internal
- **DevOps**: Moykle
- **Backend Engineer**: Blake
- **QA Lead**: Jessie
- **Orchestrator**: Quinn

### Related Documentation
- `DEPLOYMENT_RUNBOOK.md`: Detailed deployment procedures
- `RAILWAY_ENVIRONMENT_VARIABLES.md`: Complete environment variable reference
- `DEPLOYMENT_CHECKLIST.md`: Pre-deployment checklist
- `SECURITY_SCAN_REPORT.md`: Security audit results
- Infrastructure & Deployment Notion page: Source of truth for Railway configuration

---

**Version History**:
- **v1.0.0** (2025-12-04): Initial Railway setup guide for GitHub deployment
