import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { getConfig } from '../config/index.js';

/**
 * Health check status types
 */
type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Individual check result
 */
interface CheckResult {
  status: HealthStatus;
  latency_ms?: number;
  error?: string;
}

/**
 * Health check response
 */
interface HealthCheckResponse {
  status: HealthStatus;
  timestamp: string;
  version: string;
  checks: {
    database: CheckResult;
    redis: CheckResult;
    timetable_loader: CheckResult;
  };
}

/**
 * Creates the health check router
 * @param dbPool - PostgreSQL connection pool
 * @param redis - Redis client
 * @returns Express router with health check endpoint
 */
export function createHealthRouter(dbPool: Pool, redis: Redis): Router {
  const router = Router();

  /**
   * GET /health
   * Returns health status of the service and its dependencies
   * Per ADR-008: Response time <100ms
   */
  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    // Prevent caching of health check responses
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');

    const checks: HealthCheckResponse['checks'] = {
      database: { status: 'healthy' },
      redis: { status: 'healthy' },
      timetable_loader: { status: 'healthy' },
    };

    let overallStatus: HealthStatus = 'healthy';

    // Check database connection
    try {
      const startDb = Date.now();
      await dbPool.query('SELECT 1 as result');
      checks.database.latency_ms = Date.now() - startDb;
      checks.database.status = 'healthy';
    } catch (error) {
      checks.database.status = 'unhealthy';
      checks.database.error = error instanceof Error ? error.message : 'Unknown error';
      overallStatus = 'unhealthy';
    }

    // Check Redis connection
    try {
      const startRedis = Date.now();
      await redis.ping();
      checks.redis.latency_ms = Date.now() - startRedis;
      checks.redis.status = 'healthy';
    } catch (error) {
      checks.redis.status = 'unhealthy';
      checks.redis.error = error instanceof Error ? error.message : 'Unknown error';
      overallStatus = 'unhealthy';
    }

    // Check timetable-loader service (optional - don't fail if down)
    try {
      const startTimetable = Date.now();
      const config = getConfig();
      const timetableUrl = config.externalServices.timetableLoaderUrl || 'http://localhost:3001';
      const response = await fetch(`${timetableUrl}/health`, {
        signal: AbortSignal.timeout(1000), // 1 second timeout
      });

      if (response.ok) {
        checks.timetable_loader.latency_ms = Date.now() - startTimetable;
        checks.timetable_loader.status = 'healthy';
      } else {
        checks.timetable_loader.status = 'unhealthy';
        checks.timetable_loader.error = `HTTP ${response.status}`;
        // Only degrade, don't fail completely
        if (overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      }
    } catch (error) {
      checks.timetable_loader.status = 'unhealthy';
      checks.timetable_loader.error = error instanceof Error ? error.message : 'Unknown error';
      // Only degrade, don't fail completely
      if (overallStatus === 'healthy') {
        overallStatus = 'degraded';
      }
    }

    const response: HealthCheckResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: '1.0.0', // From package.json
      checks,
    };

    const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(response);
  });

  return router;
}
