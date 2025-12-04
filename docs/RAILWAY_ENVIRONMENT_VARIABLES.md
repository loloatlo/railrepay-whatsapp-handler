# Railway Environment Variables - whatsapp-handler

This document specifies all required and optional environment variables for deploying the whatsapp-handler service to Railway.

## Railway Auto-Provided Variables

Railway automatically provides these variables when you attach services:

| Variable | Source | Usage |
|----------|--------|-------|
| `DATABASE_URL` | PostgreSQL plugin | Full connection string (auto-configured) |
| `REDIS_URL` | Redis plugin | Full connection string (auto-configured) |
| `PORT` | Railway platform | HTTP server port (typically 3000) |

**Action Required**: None - Railway provisions these automatically.

## Required Service Configuration

These variables MUST be set in Railway dashboard under service settings:

### Service Identity

```bash
SERVICE_NAME=whatsapp-handler
DATABASE_SCHEMA=whatsapp_handler
NODE_ENV=production
LOG_LEVEL=info
```

### Twilio WhatsApp Integration

```bash
# Obtain from https://console.twilio.com/
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=<SECRET - Store in Railway secrets>
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

**Security Note**: Store `TWILIO_AUTH_TOKEN` as a Railway secret (not plain text).

**Twilio Setup**:
1. Create Twilio account at https://www.twilio.com/try-twilio
2. Enable WhatsApp Sandbox for testing: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
3. For production: Apply for WhatsApp Business API access
4. Configure webhook URL in Twilio console:
   - URL: `https://<railway-domain>.railway.app/webhook/twilio`
   - Method: POST
   - Events: "When a message comes in"

### Observability (Grafana Cloud)

Per ADR-006 and ADR-007, these are required for monitoring:

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

**Grafana Cloud Setup**:
1. Sign up at https://grafana.com/auth/sign-up/create-user
2. Create API key: Settings > API Keys > Add API key (role: MetricsPublisher, LogsPublisher)
3. Get Loki endpoint: Connections > Data Sources > Loki > Copy URL
4. Get Prometheus endpoint: Connections > Data Sources > Prometheus > Copy remote_write URL

**Grafana Alloy Agent**:
- Deploy as separate Railway service: `railway-grafana-alloy`
- Scrapes `/metrics` endpoint from whatsapp-handler every 15 seconds
- Forwards to Grafana Cloud Prometheus

### External Services (Optional)

```bash
# Timetable Loader Service
TIMETABLE_LOADER_URL=http://timetable-loader.railway.internal
```

**Note**: Only required if timetable-loader service is deployed. Health check degrades gracefully if unavailable.

## Optional Configuration

These have sensible defaults but can be overridden:

### Redis Caching

```bash
REDIS_CACHE_ENABLED=true
REDIS_CACHE_TTL_SECONDS=86400  # 24 hours
```

### PostgreSQL Fine-Tuning

```bash
# Only needed if not using DATABASE_URL
PGHOST=<railway-postgres-host>
PGPORT=5432
PGDATABASE=railway
PGUSER=postgres
PGPASSWORD=<SECRET>
PGSSLMODE=require  # Railway enforces SSL
```

**Note**: `DATABASE_URL` takes precedence over individual PG* variables.

## Railway Deployment Checklist

Before deploying to Railway:

- [ ] Attach PostgreSQL plugin to whatsapp-handler service
- [ ] Attach Redis plugin to whatsapp-handler service
- [ ] Set all required environment variables in Railway dashboard
- [ ] Store sensitive values (TWILIO_AUTH_TOKEN, LOKI_BASIC_AUTH) as secrets
- [ ] Verify Twilio webhook URL points to Railway deployment
- [ ] Configure Grafana Cloud data sources
- [ ] Deploy Grafana Alloy agent as separate Railway service
- [ ] Set health check path: `/health`
- [ ] Set start command: `npm run migrate:up && npm start`

## Verifying Configuration

After deployment, verify environment variables are loaded correctly:

```bash
# Check health endpoint
curl https://<railway-domain>.railway.app/health

# Expected response
{
  "status": "healthy",
  "timestamp": "2025-12-01T01:00:00.000Z",
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

## Security Best Practices

1. **Never commit secrets to Git**: Use `.env.example` template only
2. **Use Railway secrets for sensitive values**: TWILIO_AUTH_TOKEN, API keys
3. **Rotate credentials regularly**: Every 90 days minimum
4. **Enable Railway SSO/SAML**: For team access control
5. **Audit access logs**: Review Railway activity logs monthly
6. **Principle of least privilege**: Grant minimal permissions to API keys

## Troubleshooting

### Issue: "Database connection failed"

**Solution**: Verify `DATABASE_URL` is set and PostgreSQL plugin is attached.

```bash
railway logs --service whatsapp-handler | grep "Database"
```

### Issue: "Redis connection timeout"

**Solution**: Verify `REDIS_URL` is set and Redis plugin is attached.

```bash
railway logs --service whatsapp-handler | grep "Redis"
```

### Issue: "Twilio webhook signature validation failed"

**Cause**: Incorrect `TWILIO_AUTH_TOKEN` or webhook URL mismatch.

**Solution**:
1. Verify `TWILIO_AUTH_TOKEN` matches Twilio console
2. Verify webhook URL in Twilio console matches Railway deployment URL
3. Check Railway logs for signature validation errors

### Issue: "Health check failing"

**Solution**: Check Railway health check configuration:

```bash
railway logs --service whatsapp-handler --tail 100
```

Verify:
- Health check path is `/health` (not `/healthz`)
- Health check timeout is 100 seconds (for startup)
- Service is listening on `PORT` environment variable

## Migration Verification

After deployment, verify database migrations ran successfully:

```bash
railway run -s whatsapp-handler psql $DATABASE_URL -c "SELECT * FROM whatsapp_handler.pgmigrations;"
```

Expected output:

```
 id |                name                |         run_on
----+------------------------------------+------------------------
  1 | 001_create_whatsapp_handler_schema | 2025-12-01 01:00:00+00
```

## Support

For Railway-specific issues:
- Railway Docs: https://docs.railway.app/
- Railway Discord: https://discord.gg/railway
- RailRepay Internal: Contact Moykle (DevOps)

For Twilio issues:
- Twilio Docs: https://www.twilio.com/docs/whatsapp
- Twilio Support: https://support.twilio.com/

For Grafana Cloud issues:
- Grafana Docs: https://grafana.com/docs/
- Grafana Support: support@grafana.com
