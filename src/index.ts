/**
 * WhatsApp Handler Service - Entry Point
 *
 * Day 6: Complete Express application with all routes
 *
 * ADR Compliance:
 * - ADR-008: Health check endpoint implemented
 * - ADR-002: Correlation IDs via middleware
 * - ADR-014: TDD implementation (tests written first)
 * - ADR-012: OpenAPI validation (spec in openapi.yaml)
 */

import express from 'express';
import Redis from 'ioredis';
import { MetricsPusher } from '@railrepay/metrics-pusher';
import { getConfig } from './config/index.js';
import { createDatabaseClientFromEnv } from './db/client.js';
import { createWebhookRouter } from './routes/webhook.js';
import { createHealthRouter } from './routes/health.js';
import { createMetricsRouter, initializeMetrics } from './routes/metrics.js';
import { errorHandler } from './middleware/error-handler.js';
import { initializeHandlers } from './handlers/index.js';
import { getLogger } from './lib/logger.js';

// Load configuration
const config = getConfig();
const logger = getLogger();

// Create Express app
const app = express();

// Initialize database client
const dbClient = createDatabaseClientFromEnv();
await dbClient.initialize();
const dbPool = dbClient.getPool();

// Initialize Redis client (ioredis for all Redis operations)
// TODO (TD-WHATSAPP-018): Migrate to @railrepay/redis-cache (requires node-redis v4)
const redis = new Redis(config.redis.url);

// Initialize all FSM handlers
await initializeHandlers();

// Initialize metrics (registers counters with shared registry)
initializeMetrics();

// Initialize MetricsPusher for push-based observability (ADR-006)
// Pushes metrics to Grafana Alloy at configured intervals
const metricsPusher = new MetricsPusher({
  serviceName: config.serviceName,
  logger,
});
await metricsPusher.start();

// Global middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
/**
 * Health Check Endpoint (ADR-008)
 * Required for Railway health checks and liveness probes
 * Response time <100ms
 */
app.use('/health', createHealthRouter(dbPool, redis));

/**
 * Metrics Endpoint (Prometheus format)
 * Required for Grafana Alloy scraping
 * Port 9090 per configuration
 */
app.use('/metrics', createMetricsRouter());

/**
 * Twilio WhatsApp Webhook (Complete implementation)
 * Full webhook handler with:
 * - Twilio signature validation middleware
 * - Rate limiting (60 req/min per phone)
 * - Correlation IDs
 * - Idempotency checking
 * - FSM state machine logic with handler registry
 * - Event publishing to outbox
 * - Message formatter
 */
app.use('/webhook', createWebhookRouter(redis, dbPool));

/**
 * Root endpoint
 */
app.get('/', (_req, res) => {
  res.status(200).json({
    service: config.serviceName,
    version: '1.0.0',
    status: 'running',
  });
});

/**
 * Error Handler Middleware (MUST be last)
 * Catches all unhandled errors from routes and middleware
 */
app.use(errorHandler());

/**
 * Start HTTP server
 */
const PORT = config.port;
const server = app.listen(PORT, () => {
  logger.info('WhatsApp Handler service started', {
    component: 'whatsapp-handler/server',
    port: PORT,
    environment: config.nodeEnv,
    databaseSchema: config.databaseSchema,
    redisUrl: config.redis.url,
  });
});

/**
 * Graceful shutdown
 * Handles SIGTERM and SIGINT signals
 */
async function shutdown(signal: string) {
  logger.info('Shutdown signal received', {
    component: 'whatsapp-handler/server',
    signal,
  });

  // Close HTTP server first (stop accepting new requests)
  server.close(() => {
    logger.info('HTTP server closed', {
      component: 'whatsapp-handler/server',
    });
  });

  // Stop metrics pusher
  metricsPusher.stop();
  logger.info('Metrics pusher stopped', {
    component: 'whatsapp-handler/server',
  });

  // Close database connections
  try {
    await dbClient.disconnect();
    logger.info('Database pool disconnected', {
      component: 'whatsapp-handler/server',
    });
  } catch (error) {
    logger.error('Error disconnecting database', {
      component: 'whatsapp-handler/server',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Close Redis connection
  redis.disconnect();
  logger.info('Redis disconnected', {
    component: 'whatsapp-handler/server',
  });

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, dbPool, redis };
