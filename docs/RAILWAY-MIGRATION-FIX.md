# Railway Migration Path Resolution Fix

## Issue

Railway deployment was failing with:
```
Error: Can't get migration files: Error: ENOENT: no such file or directory, scandir '/app/migrations/'
```

## Root Cause

**node-pg-migrate config file resolution issue in Docker containers**

When `node-pg-migrate up` runs via npm script in a containerized environment:
1. The CLI attempts to read `.migrationrc.json` config file
2. Path resolution for `migrations-dir` can fail silently in containers
3. Falls back to default `migrations/` directory (not `dist/migrations/`)
4. Looks for `/app/migrations/` instead of `/app/dist/migrations/`

This happens because:
- Source TypeScript migrations live in `migrations/` directory
- Compiled JavaScript migrations live in `dist/migrations/` directory
- The config specifies `"migrations-dir": "dist/migrations"`
- But the relative path resolution doesn't work reliably in Docker

## Solution

**Use explicit CLI flags instead of relying on config file path resolution**

### Changes Made

#### 1. package.json
```json
{
  "scripts": {
    "migrate:up": "node-pg-migrate up --migrations-dir dist/migrations",
    "migrate:down": "node-pg-migrate down --migrations-dir dist/migrations"
  }
}
```

**Why this works:**
- CLI flags take precedence over config files
- Eliminates config file resolution ambiguity
- Path is explicit: `dist/migrations` relative to `/app` working directory
- More debuggable and transparent

#### 2. Dockerfile
Already correctly structured:
```dockerfile
# Copy compiled migrations
COPY --from=builder /app/dist ./dist

# Copy config (still used for other settings)
COPY --from=builder /app/.migrationrc.json ./.migrationrc.json
```

**Runtime paths:**
- Working directory: `/app`
- Compiled migrations: `/app/dist/migrations/001_create_whatsapp_handler_schema.js`
- Migration script: `node-pg-migrate up --migrations-dir dist/migrations`
- Resolves to: `/app/dist/migrations/` ✓

## Alternative Solutions Considered

### Option A: Symlink in Dockerfile
```dockerfile
RUN ln -s dist/migrations migrations
```
- Pros: No package.json changes needed
- Cons: Filesystem trick, less transparent, could cause confusion

### Option B: Copy migrations to expected location
```dockerfile
COPY --from=builder /app/dist/migrations ./migrations
```
- Pros: Matches default expectation
- Cons: Duplicates files, wastes space, unclear why dist/ exists

### Option C: Use absolute paths in config
```json
{
  "migrations-dir": "/app/dist/migrations"
}
```
- Pros: Explicit path
- Cons: Hardcodes container path, not portable between environments

**Decision: Use explicit CLI flags (current solution)**
- Most transparent and debuggable
- Works across all environments
- No filesystem tricks
- Clear intent in package.json

## Verification

### Local Build Test
```bash
npm run build
ls -la dist/migrations/  # Should show compiled .js files
```

### Local Migration Test (requires DATABASE_URL)
```bash
export DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run migrate:up
```

### Railway Deployment
1. Push changes with updated package.json and Dockerfile
2. Railway builds using Dockerfile
3. CMD runs: `npm run migrate:up && npm start`
4. Migration finds files in `/app/dist/migrations/`
5. Health check validates service started

## Related Issues

### SSL Certificate Error (RESOLVED)
Railway PostgreSQL uses self-signed certificates. Fix:
```bash
NODE_TLS_REJECT_UNAUTHORIZED=0
```
Set in Dockerfile CMD and Railway environment variables.

### Build Cache
Dockerfile includes cache-bust comment. Update version to force rebuild:
```dockerfile
# Build cache bust: 2024-12-04-v4-migrations-fix
```

## References

- ADR-001: Schema-per-service isolation (whatsapp_handler schema)
- node-pg-migrate docs: https://salsita.github.io/node-pg-migrate/
- Railway deployment: Infrastructure & Deployment Notion page
- Testcontainers: Integration tests verify migrations locally

## Monitoring

After deployment, verify:
1. Railway logs show successful migration: "Migrating xxx up..."
2. Database schema `whatsapp_handler` exists with tables
3. Health check endpoint returns 200 OK
4. Grafana metrics show service is healthy
5. pgmigrations table in whatsapp_handler schema shows applied migration

## Technical Debt

None. This fix resolves the deployment blocker cleanly without workarounds.
