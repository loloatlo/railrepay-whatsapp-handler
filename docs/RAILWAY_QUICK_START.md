# Railway Quick Start - whatsapp-handler

**5-Minute Setup Guide**

## Prerequisites Checklist

- [ ] Railway account: https://railway.app/
- [ ] GitHub repo: `loloatlo/railrepay-whatsapp-handler` (public or connected)
- [ ] Twilio account with WhatsApp sandbox
- [ ] Grafana Cloud account (optional)

## Step-by-Step Setup

### 1. Create Railway Project (2 minutes)

```bash
# Go to Railway dashboard
https://railway.app/dashboard

# Click "New Project" → "Deploy from GitHub repo"
# Select: loloatlo/railrepay-whatsapp-handler
```

**Result**: Railway creates project with one service

### 2. Add Database & Redis (1 minute)

```bash
# In project dashboard, click "+ New" → "Database" → "PostgreSQL"
# Click "+ New" → "Database" → "Redis"

# Link to whatsapp-handler:
# Service Settings → Variables → "+ Reference" → PostgreSQL (add all)
# Service Settings → Variables → "+ Reference" → Redis (add all)
```

**Result**: `DATABASE_URL` and `REDIS_URL` auto-injected

### 3. Set Environment Variables (2 minutes)

In whatsapp-handler service Variables tab, add:

```bash
# Required
SERVICE_NAME=whatsapp-handler
DATABASE_SCHEMA=whatsapp_handler
NODE_ENV=production
LOG_LEVEL=info

# Twilio (get from https://console.twilio.com/)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here (mark as secret ✓)
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

**Result**: All required variables set

### 4. Enable Public Domain (30 seconds)

```bash
# Service Settings → Networking → "Generate Domain"
```

**Result**: Get URL like `whatsapp-handler-production.up.railway.app`

### 5. Configure Twilio Webhook (30 seconds)

```bash
# Go to: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
# Webhook URL: https://<railway-domain>/webhook/twilio
# Method: POST
```

**Result**: Twilio sends messages to Railway deployment

### 6. Deploy & Verify (1 minute)

Railway auto-deploys on GitHub push. Verify:

```bash
# Check health
curl https://<railway-domain>/health

# Expected response
{"status":"healthy","timestamp":"2025-12-04T00:00:00.000Z","checks":{"database":{"status":"healthy"}}}

# Check logs
railway logs -s whatsapp-handler --tail 50

# Look for
✓ Database pool initialized
✓ Redis connected
✓ whatsapp-handler listening on port 3000
✓ Health check passed
```

## Configuration Files

Railway reads these automatically from the repo:

- **railway.toml**: Build & deploy config (✓ updated to use Dockerfile)
- **Dockerfile**: Multi-stage build with migrations
- **.github/workflows/ci-cd.yml**: GitHub Actions CI/CD

**No manual Railway configuration needed!**

## Quick Commands

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link

# View logs
railway logs -s whatsapp-handler --follow

# Run migrations manually
railway run -s whatsapp-handler npm run migrate:up

# Rollback deployment
railway rollback <deployment-id>

# Open dashboard
railway open
```

## Verification Checklist

After deployment, verify:

- [ ] Health check returns 200: `curl https://<railway-domain>/health`
- [ ] Metrics endpoint works: `curl https://<railway-domain>/metrics`
- [ ] Database migration ran: `railway run -s whatsapp-handler psql $DATABASE_URL -c "SELECT * FROM whatsapp_handler.pgmigrations;"`
- [ ] Twilio webhook receives messages: Send test WhatsApp message
- [ ] Logs are clean: `railway logs -s whatsapp-handler | grep -i error` (no critical errors)

## Troubleshooting

### Deployment fails?
```bash
railway logs -s whatsapp-handler --tail 100
# Look for build errors or missing dependencies
```

### Health check fails?
```bash
# Check DATABASE_URL and REDIS_URL are set
railway run -s whatsapp-handler env | grep -E "DATABASE_URL|REDIS_URL"
```

### Migrations fail?
```bash
# Check migration logs
railway logs -s whatsapp-handler | grep migration

# Run migrations manually
railway run -s whatsapp-handler npm run migrate:up
```

### Twilio webhook fails?
```bash
# Verify TWILIO_AUTH_TOKEN is correct
railway run -s whatsapp-handler env | grep TWILIO_AUTH_TOKEN

# Check webhook signature validation logs
railway logs -s whatsapp-handler | grep signature
```

## Next Steps

1. **Monitor for 1 hour**: Watch logs and metrics
2. **Set up Grafana Cloud**: For advanced observability (optional)
3. **Configure alerts**: Set up PagerDuty/OpsGenie
4. **Run smoke tests**: `npm run test:smoke`
5. **Document rollback**: Test Railway rollback procedure

## Full Documentation

See `RAILWAY_SETUP_GUIDE.md` for complete setup instructions and troubleshooting.

---

**Need Help?**
- Railway Docs: https://docs.railway.app/
- Railway Discord: https://discord.gg/railway
- RailRepay DevOps: Moykle
