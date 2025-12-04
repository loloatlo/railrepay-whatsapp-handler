# Multi-stage Dockerfile for whatsapp-handler service
# Railway deployment alternative to Nixpacks

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

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# Copy migrations for Railway deployment
COPY --from=builder /app/migrations ./migrations

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
CMD ["sh", "-c", "npm run migrate:up && npm start"]
