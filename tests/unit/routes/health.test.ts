/**
 * TD-WHATSAPP-027 (BL-26): Health endpoint — remove timetable-loader check
 *
 * CONTEXT: The health endpoint previously called timetable-loader on every
 * health check, causing "degraded" status when timetable-loader was unreachable
 * even though the service's core dependencies (database, Redis) were fine.
 *
 * REQUIRED FIX: Remove timetable_loader from health checks entirely.
 * The endpoint must check ONLY database and redis.
 *
 * Test Lock Rule: Blake MUST NOT modify these tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { createHealthRouter } from '../../../src/routes/health';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

// NOTE: Config mock removed — timetableLoaderUrl is no longer needed
// after timetable-loader check is removed from health endpoint.

describe('TD-WHATSAPP-027 (BL-26): Health Check Route', () => {
  let mockDbPool: Pool;
  let mockRedis: Redis;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock database pool
    mockDbPool = {
      query: vi.fn(),
    } as unknown as Pool;

    // Mock Redis client
    mockRedis = {
      ping: vi.fn(),
    } as unknown as Redis;

    // Mock Express request/response
    mockRequest = {
      method: 'GET',
      path: '/health',
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();

    // Spy on global.fetch — must NOT be called by the health endpoint.
    // Do not provide a mock implementation; if fetch IS called it will
    // throw and the spy will capture the call.
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // AC-1: Health endpoint returns only database and redis checks
  // AC-2: No timetable_loader in checks object
  // ---------------------------------------------------------------------------
  describe('AC-1 & AC-2: Response shape — only database and redis checks', () => {
    it('should return checks object containing ONLY database and redis keys', async () => {
      // AC-1: Health endpoint returns only database and redis checks
      // AC-2: No timetable_loader in checks object
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];

      // AC-1: Must have database and redis
      expect(jsonCall?.checks).toHaveProperty('database');
      expect(jsonCall?.checks).toHaveProperty('redis');

      // AC-2: Must NOT have timetable_loader
      expect(jsonCall?.checks).not.toHaveProperty('timetable_loader');

      // AC-1: Exactly two keys — no extras
      expect(Object.keys(jsonCall?.checks)).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-3: Status is "healthy" when both database and redis are up
  // ---------------------------------------------------------------------------
  describe('AC-3: Healthy state — both database and redis are up', () => {
    it('should return 200 with status "healthy" when database and redis both pass', async () => {
      // AC-3: Status is "healthy" when both database and redis are up
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          timestamp: expect.any(String),
          version: '1.0.0',
          checks: {
            database: {
              status: 'healthy',
              latency_ms: expect.any(Number),
            },
            redis: {
              status: 'healthy',
              latency_ms: expect.any(Number),
            },
          },
        })
      );
    });

    it('should include cache-control header to prevent caching', async () => {
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.header).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache, no-store, must-revalidate'
      );
    });

    it('should measure database latency accurately', async () => {
      // AC-3: Latency measurement must reflect real elapsed time
      vi.mocked(mockDbPool.query).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                rows: [{ result: 1 }],
                command: 'SELECT',
                rowCount: 1,
                oid: 0,
                fields: [],
              });
            }, 10); // 10ms delay
          })
      );
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];
      expect(jsonCall?.checks?.database?.latency_ms).toBeGreaterThanOrEqual(10);
    });

    it('should measure Redis latency accurately', async () => {
      // AC-3: Redis latency measurement must reflect real elapsed time
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve('PONG'), 5); // 5ms delay
          })
      );

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];
      expect(jsonCall?.checks?.redis?.latency_ms).toBeGreaterThanOrEqual(5);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-4: Status is "degraded" only when database OR redis is degraded
  // ---------------------------------------------------------------------------
  describe('AC-4: Degraded state — triggered by database or redis only', () => {
    it('should NOT return degraded status when only timetable-loader would be unavailable', async () => {
      // AC-4: External service unavailability must not affect status.
      // Previously, timetable-loader failure would cause "degraded".
      // With the fix, there is no scenario where "degraded" is returned
      // solely because of an external service — degraded must come from
      // database or redis being in a degraded state.
      //
      // Since the current implementation does not have a "db degraded" path
      // (only healthy or unhealthy), this test verifies that all-healthy
      // database + redis = "healthy", not "degraded".
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];
      // Must be healthy — NOT degraded (which the old code would produce
      // when timetable-loader was down, even with DB + Redis healthy)
      expect(jsonCall?.status).toBe('healthy');
    });
  });

  // ---------------------------------------------------------------------------
  // AC-5: Status is "unhealthy" only when database OR redis is down
  // ---------------------------------------------------------------------------
  describe('AC-5: Unhealthy state — database or redis failure', () => {
    it('should return 503 with status "unhealthy" when database is down', async () => {
      // AC-5: Status is "unhealthy" only when database OR redis is down
      vi.mocked(mockDbPool.query).mockRejectedValue(new Error('Connection refused'));
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          checks: {
            database: {
              status: 'unhealthy',
              error: 'Connection refused',
            },
            redis: { status: 'healthy', latency_ms: expect.any(Number) },
          },
        })
      );
    });

    it('should return 503 with status "unhealthy" when Redis is down', async () => {
      // AC-5: Status is "unhealthy" only when database OR redis is down
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockRejectedValue(new Error('Redis connection lost'));

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          checks: {
            database: { status: 'healthy', latency_ms: expect.any(Number) },
            redis: {
              status: 'unhealthy',
              error: 'Redis connection lost',
            },
          },
        })
      );
    });

    it('should return 503 with status "unhealthy" when both database and Redis are down', async () => {
      // AC-5: Status is "unhealthy" only when database OR redis is down
      vi.mocked(mockDbPool.query).mockRejectedValue(new Error('DB error'));
      vi.mocked(mockRedis.ping).mockRejectedValue(new Error('Redis error'));

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          checks: {
            database: { status: 'unhealthy', error: 'DB error' },
            redis: { status: 'unhealthy', error: 'Redis error' },
          },
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // AC-6: No external HTTP fetch calls made during health check
  // ---------------------------------------------------------------------------
  describe('AC-6: No external HTTP fetch calls during health check', () => {
    it('should NOT call global.fetch at any point during a healthy health check', async () => {
      // AC-6: No external HTTP fetch calls made during health check
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should NOT call global.fetch when database is down', async () => {
      // AC-6: No external HTTP fetch calls made during health check —
      // even in error paths, fetch must not be invoked.
      vi.mocked(mockDbPool.query).mockRejectedValue(new Error('Connection refused'));
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should NOT call global.fetch when Redis is down', async () => {
      // AC-6: No external HTTP fetch calls made during health check —
      // even in error paths, fetch must not be invoked.
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockRejectedValue(new Error('Redis connection lost'));

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // AC-7: Response time is not affected by external service availability
  // ---------------------------------------------------------------------------
  describe('AC-7: Response time unaffected by external service availability', () => {
    it('should complete in under 100ms without any external HTTP calls', async () => {
      // AC-7: Response time is not affected by external service availability.
      // Previously a 1000ms timeout was applied to the timetable-loader fetch,
      // meaning a slow/unavailable service would delay the health response.
      // With the fix, health check completes purely from local DB + Redis checks.
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      const start = Date.now();
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);
      const duration = Date.now() - start;

      // ADR-008: <100ms requirement. This is reliably achievable because
      // there are no external HTTP calls with their associated timeouts.
      expect(duration).toBeLessThan(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Response format validation
  // ---------------------------------------------------------------------------
  describe('Response Format Validation', () => {
    it('should include ISO 8601 timestamp', async () => {
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];
      expect(jsonCall?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should include version field', async () => {
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];
      expect(jsonCall?.version).toBe('1.0.0');
    });
  });
});
