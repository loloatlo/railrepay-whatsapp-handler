# Multi-stage Dockerfile for whatsapp-handler service
# Railway deployment alternative to Nixpacks
# Build cache bust: 2024-12-05-v6-remove-file-language-flag
#
# MIGRATION FIX: ESM/CommonJS Compatibility
# - package.json has "type": "module" (ESM)
# - Migrations are compiled to CommonJS (node-pg-migrate requirement)
# - Build script renames compiled .js migrations to .cjs for compatibility
# - node-pg-migrate can require() .cjs files successfully

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production

# Copy compiled JavaScript from builder (includes dist/migrations)
COPY --from=builder /app/dist ./dist

# Copy migration config
COPY --from=builder /app/.migrationrc.json ./.migrationrc.json

# Set environment to production
ENV NODE_ENV=production

# Expose port (Railway overrides with $PORT)
EXPOSE 3000

# Health check per ADR-008
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run migrations then start server
# Note: Railway provides individual PG* vars, not DATABASE_URL
# We construct DATABASE_URL for node-pg-migrate and disable TLS cert verification
# for self-signed certificates used by Railway PostgreSQL
# The migrate:up script now explicitly uses --migrations-dir flag to avoid
# config file resolution issues in containerized environments
CMD ["sh", "-c", "export DATABASE_URL=\"postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}/${PGDATABASE}?sslmode=require\" && NODE_TLS_REJECT_UNAUTHORIZED=0 npm run migrate:up && npm start"]
