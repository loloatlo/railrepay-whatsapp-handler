import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { createHealthRouter } from '../../../src/routes/health';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

// Mock the config module
vi.mock('../../../src/config/index', () => ({
  getConfig: vi.fn().mockReturnValue({
    externalServices: {
      timetableLoaderUrl: 'http://localhost:3001',
    },
  }),
}));

describe('Health Check Route', () => {
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health - Healthy State', () => {
    it('should return 200 with healthy status when all checks pass', async () => {
      // Arrange
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      } as Response);

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      const start = Date.now();
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);
      const duration = Date.now() - start;

      // Assert
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
            timetable_loader: {
              status: 'healthy',
              latency_ms: expect.any(Number),
            },
          },
        })
      );
      expect(duration).toBeLessThan(100); // ADR-008: <100ms requirement
    });

    it('should include cache-control header to prevent caching', async () => {
      // Arrange
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

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(mockResponse.header).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache, no-store, must-revalidate'
      );
    });

    it('should measure database latency accurately', async () => {
      // Arrange
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

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];
      expect(jsonCall?.checks?.database?.latency_ms).toBeGreaterThanOrEqual(10);
    });

    it('should measure Redis latency accurately', async () => {
      // Arrange
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

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];
      expect(jsonCall?.checks?.redis?.latency_ms).toBeGreaterThanOrEqual(5);
    });
  });

  describe('GET /health - Degraded State', () => {
    it('should return 200 with degraded status when timetable-loader is down', async () => {
      // Arrange
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'degraded',
          checks: {
            database: { status: 'healthy', latency_ms: expect.any(Number) },
            redis: { status: 'healthy', latency_ms: expect.any(Number) },
            timetable_loader: {
              status: 'unhealthy',
              error: 'Connection refused',
            },
          },
        })
      );
    });

    it('should return degraded when timetable-loader returns non-200', async () => {
      // Arrange
      vi.mocked(mockDbPool.query).mockResolvedValue({
        rows: [{ result: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      } as Response);

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'degraded',
          checks: expect.objectContaining({
            timetable_loader: {
              status: 'unhealthy',
              error: 'HTTP 503',
            },
          }),
        })
      );
    });
  });

  describe('GET /health - Unhealthy State', () => {
    it('should return 503 when database is down', async () => {
      // Arrange
      vi.mocked(mockDbPool.query).mockRejectedValue(new Error('Connection refused'));
      vi.mocked(mockRedis.ping).mockResolvedValue('PONG');

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
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
            timetable_loader: expect.any(Object),
          },
        })
      );
    });

    it('should return 503 when Redis is down', async () => {
      // Arrange
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

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
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
            timetable_loader: expect.any(Object),
          },
        })
      );
    });

    it('should return 503 when both database and Redis are down', async () => {
      // Arrange
      vi.mocked(mockDbPool.query).mockRejectedValue(new Error('DB error'));
      vi.mocked(mockRedis.ping).mockRejectedValue(new Error('Redis error'));

      const router = createHealthRouter(mockDbPool, mockRedis);
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          checks: {
            database: { status: 'unhealthy', error: 'DB error' },
            redis: { status: 'unhealthy', error: 'Redis error' },
            timetable_loader: expect.any(Object),
          },
        })
      );
    });
  });

  describe('Response Format Validation', () => {
    it('should include ISO 8601 timestamp', async () => {
      // Arrange
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

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];
      expect(jsonCall?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should include version from package.json', async () => {
      // Arrange
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

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];
      expect(jsonCall?.version).toBe('1.0.0');
    });

    it('should include all required check fields', async () => {
      // Arrange
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

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      const jsonCall = vi.mocked(mockResponse.json).mock.calls[0]?.[0];
      expect(jsonCall?.checks).toHaveProperty('database');
      expect(jsonCall?.checks).toHaveProperty('redis');
      expect(jsonCall?.checks).toHaveProperty('timetable_loader');
    });
  });
});
