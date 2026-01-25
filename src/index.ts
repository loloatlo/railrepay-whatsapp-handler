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
import { setPool } from './db/pool.js';
import { createWebhookRouter } from './routes/webhook.js';
import { createHealthRouter } from './routes/health.js';
import { createMetricsRouter, initializeMetrics } from './routes/metrics.js';
import { errorHandler } from './middleware/error-handler.js';
import { initializeHandlers } from './handlers/index.js';
import { getLogger } from './lib/logger.js';

// Log startup immediately so we can see something in Railway logs
console.log('[whatsapp-handler] Starting service...');

// Wrap entire startup in try-catch to catch and log any errors
let config: ReturnType<typeof getConfig>;
let logger: ReturnType<typeof getLogger>;
let dbClient: ReturnType<typeof createDatabaseClientFromEnv>;
let dbPool: ReturnType<typeof dbClient.getPool>;
let redis: Redis;
let metricsPusher: MetricsPusher;
let server: ReturnType<typeof app.listen>;

// Create Express app
const app = express();

// Enable trust proxy for Railway/proxy environments
// This allows req.protocol and req.hostname to use X-Forwarded-* headers
// CRITICAL: Required for Twilio signature validation behind reverse proxy
app.set('trust proxy', true);

try {
  // Load configuration
  console.log('[whatsapp-handler] Loading configuration...');
  config = getConfig();
  console.log('[whatsapp-handler] Configuration loaded successfully');
  console.log('[whatsapp-handler] SERVICE_NAME:', config.serviceName);
  console.log('[whatsapp-handler] NODE_ENV:', config.nodeEnv);
  console.log('[whatsapp-handler] PORT:', config.port);
  console.log('[whatsapp-handler] Database URL:', config.database.url ? 'SET' : 'NOT SET');
  console.log('[whatsapp-handler] Redis URL:', config.redis.url ? 'SET' : 'NOT SET');

  logger = getLogger();

  // Initialize database client
  console.log('[whatsapp-handler] Initializing database client...');
  dbClient = createDatabaseClientFromEnv();
  await dbClient.initialize();
  dbPool = dbClient.getPool();
  setPool(dbPool); // Make pool available to services via getPool()
  console.log('[whatsapp-handler] Database client initialized');

  // Initialize Redis client (ioredis for all Redis operations)
  console.log('[whatsapp-handler] Connecting to Redis...');
  redis = new Redis(config.redis.url);

  // Wait for Redis to connect
  await new Promise<void>((resolve, reject) => {
    redis.on('connect', () => {
      console.log('[whatsapp-handler] Redis connected');
      resolve();
    });
    redis.on('error', (err) => {
      console.error('[whatsapp-handler] Redis connection error:', err.message);
      reject(err);
    });
    // Timeout after 10 seconds
    setTimeout(() => reject(new Error('Redis connection timeout')), 10000);
  });

  // Initialize all FSM handlers
  console.log('[whatsapp-handler] Initializing FSM handlers...');
  await initializeHandlers();
  console.log('[whatsapp-handler] FSM handlers initialized');

  // Initialize metrics (registers counters with shared registry)
  console.log('[whatsapp-handler] Initializing metrics...');
  initializeMetrics();

  // Initialize MetricsPusher for push-based observability (ADR-006)
  console.log('[whatsapp-handler] Starting metrics pusher...');
  metricsPusher = new MetricsPusher({
    serviceName: config.serviceName,
    logger,
  });
  await metricsPusher.start();
  console.log('[whatsapp-handler] Metrics pusher started');

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
      version: '1.0.2',
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
  console.log('[whatsapp-handler] Starting HTTP server on port', PORT);
  server = app.listen(PORT, () => {
    console.log('[whatsapp-handler] HTTP server listening on port', PORT);
    logger.info('WhatsApp Handler service started', {
      component: 'whatsapp-handler/server',
      port: PORT,
      environment: config.nodeEnv,
      databaseSchema: config.databaseSchema,
      redisUrl: config.redis.url,
    });
  });
} catch (error) {
  console.error('[whatsapp-handler] FATAL: Startup failed');
  console.error('[whatsapp-handler] Error:', error instanceof Error ? error.message : error);
  console.error('[whatsapp-handler] Stack:', error instanceof Error ? error.stack : 'N/A');

  // Log environment variables that might be missing (without values for security)
  console.error('[whatsapp-handler] Environment check:');
  console.error('  SERVICE_NAME:', process.env.SERVICE_NAME ? 'SET' : 'MISSING');
  console.error('  DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');
  console.error('  PGHOST:', process.env.PGHOST ? 'SET' : 'MISSING');
  console.error('  PGPORT:', process.env.PGPORT ? 'SET' : 'MISSING');
  console.error('  PGUSER:', process.env.PGUSER ? 'SET' : 'MISSING');
  console.error('  PGPASSWORD:', process.env.PGPASSWORD ? 'SET' : 'MISSING');
  console.error('  PGDATABASE:', process.env.PGDATABASE ? 'SET' : 'MISSING');
  console.error('  REDIS_URL:', process.env.REDIS_URL ? 'SET' : 'MISSING');
  console.error('  REDIS_HOST:', process.env.REDIS_HOST ? 'SET' : 'MISSING');
  console.error('  TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? 'SET' : 'MISSING');
  console.error('  TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? 'SET' : 'MISSING');
  console.error('  TWILIO_WHATSAPP_NUMBER:', process.env.TWILIO_WHATSAPP_NUMBER ? 'SET' : 'MISSING');

  process.exit(1);
}

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
