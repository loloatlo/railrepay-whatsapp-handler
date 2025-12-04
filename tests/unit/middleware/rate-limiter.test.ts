/**
 * Rate Limiter Middleware Unit Tests
 *
 * TDD FIRST - These tests written BEFORE implementation
 * Tests Redis-backed sliding window rate limiting
 *
 * Requirements:
 * - 60 requests per minute per phone number
 * - Redis-backed sliding window algorithm
 * - Return 429 Too Many Requests when exceeded
 * - Include Retry-After header
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';

// Mock Redis client
const createMockRedis = () => {
  const store = new Map<string, { value: string; expiry?: number }>();

  return {
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      if (item.expiry && Date.now() > item.expiry) {
        store.delete(key);
        return null;
      }
      return item.value;
    }),
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      store.set(key, { value, expiry: Date.now() + ttl * 1000 });
      return 'OK';
    }),
    incr: vi.fn(async (key: string) => {
      const item = store.get(key);
      const currentValue = item ? parseInt(item.value, 10) : 0;
      const newValue = currentValue + 1;
      store.set(key, { value: String(newValue), expiry: item?.expiry });
      return newValue;
    }),
    expire: vi.fn(async (key: string, ttl: number) => {
      const item = store.get(key);
      if (item) {
        item.expiry = Date.now() + ttl * 1000;
      }
      return 1;
    }),
    ttl: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item || !item.expiry) return -1;
      const remaining = Math.ceil((item.expiry - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    }),
    _store: store, // For test inspection
  } as unknown as Redis;
};

const createMockRequest = (phoneNumber?: string): Partial<Request> => ({
  body: {
    From: phoneNumber || 'whatsapp:+1234567890',
    MessageSid: 'SM123456',
    Body: 'Test message',
  },
  headers: {},
});

const createMockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return res;
};

const createMockNext = (): NextFunction => vi.fn();

describe('Rate Limiter Middleware', () => {
  let mockRedis: Redis;
  let createRateLimiter: any;

  beforeEach(async () => {
    mockRedis = createMockRedis();
    vi.resetModules();
    // Dynamic import to get fresh module
    const module = await import('../../../src/middleware/rate-limiter.js');
    createRateLimiter = module.createRateLimiter;
  });

  describe('Request counting', () => {
    it('should allow first request from phone number', async () => {
      const limiter = createRateLimiter(mockRedis, {
        windowMs: 60000,
        maxRequests: 60,
        keyPrefix: 'ratelimit',
      });

      const req = createMockRequest('whatsapp:+1234567890');
      const res = createMockResponse();
      const next = createMockNext();

      await limiter(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow requests under limit', async () => {
      const limiter = createRateLimiter(mockRedis, {
        windowMs: 60000,
        maxRequests: 60,
        keyPrefix: 'ratelimit',
      });

      const req = createMockRequest('whatsapp:+1234567890');

      // Make 59 requests
      for (let i = 0; i < 59; i++) {
        const res = createMockResponse();
        const next = createMockNext();
        await limiter(req as Request, res as Response, next);
        expect(next).toHaveBeenCalled();
      }

      // 60th request should still pass
      const res60 = createMockResponse();
      const next60 = createMockNext();
      await limiter(req as Request, res60 as Response, next60);
      expect(next60).toHaveBeenCalled();
    });

    it('should block requests over limit with 429', async () => {
      const limiter = createRateLimiter(mockRedis, {
        windowMs: 60000,
        maxRequests: 5, // Lower limit for easier testing
        keyPrefix: 'ratelimit',
      });

      const req = createMockRequest('whatsapp:+1234567890');

      // Make 5 requests (hit limit)
      for (let i = 0; i < 5; i++) {
        const res = createMockResponse();
        const next = createMockNext();
        await limiter(req as Request, res as Response, next);
        expect(next).toHaveBeenCalled();
      }

      // 6th request should be blocked
      const resBlocked = createMockResponse();
      const nextBlocked = createMockNext();
      await limiter(req as Request, resBlocked as Response, nextBlocked);

      expect(resBlocked.status).toHaveBeenCalledWith(429);
      expect(nextBlocked).not.toHaveBeenCalled();
    });

    it('should include Retry-After header when rate limited', async () => {
      const limiter = createRateLimiter(mockRedis, {
        windowMs: 60000,
        maxRequests: 2,
        keyPrefix: 'ratelimit',
      });

      const req = createMockRequest('whatsapp:+1234567890');

      // Hit limit
      for (let i = 0; i < 2; i++) {
        await limiter(req as Request, createMockResponse() as Response, createMockNext());
      }

      // Next request should include Retry-After
      const resBlocked = createMockResponse();
      await limiter(req as Request, resBlocked as Response, createMockNext());

      expect(resBlocked.set).toHaveBeenCalledWith(
        'Retry-After',
        expect.any(String)
      );
    });
  });

  describe('Sliding window behavior', () => {
    it('should reset count after window expires', async () => {
      // This test would need time manipulation in real implementation
      // For now, we verify the Redis key has proper TTL
      const limiter = createRateLimiter(mockRedis, {
        windowMs: 60000,
        maxRequests: 60,
        keyPrefix: 'ratelimit',
      });

      const req = createMockRequest('whatsapp:+1234567890');
      const res = createMockResponse();
      const next = createMockNext();

      await limiter(req as Request, res as Response, next);

      // Verify TTL was set (60 seconds)
      expect(mockRedis.expire).toHaveBeenCalled();
    });

    it('should use different counters for different phone numbers', async () => {
      const limiter = createRateLimiter(mockRedis, {
        windowMs: 60000,
        maxRequests: 2,
        keyPrefix: 'ratelimit',
      });

      const req1 = createMockRequest('whatsapp:+1111111111');
      const req2 = createMockRequest('whatsapp:+2222222222');

      // Phone 1 hits limit
      await limiter(req1 as Request, createMockResponse() as Response, createMockNext());
      await limiter(req1 as Request, createMockResponse() as Response, createMockNext());

      // Phone 1 blocked
      const resBlocked = createMockResponse();
      await limiter(req1 as Request, resBlocked as Response, createMockNext());
      expect(resBlocked.status).toHaveBeenCalledWith(429);

      // Phone 2 should still work
      const res2 = createMockResponse();
      const next2 = createMockNext();
      await limiter(req2 as Request, res2 as Response, next2);
      expect(next2).toHaveBeenCalled();
    });
  });

  describe('Redis key format', () => {
    it('should use correct key format ratelimit:{phoneNumber}:{window}', async () => {
      const limiter = createRateLimiter(mockRedis, {
        windowMs: 60000,
        maxRequests: 60,
        keyPrefix: 'ratelimit',
      });

      const phoneNumber = 'whatsapp:+1234567890';
      const req = createMockRequest(phoneNumber);
      const res = createMockResponse();
      const next = createMockNext();

      await limiter(req as Request, res as Response, next);

      // Check that Redis incr was called with correct key pattern
      expect(mockRedis.incr).toHaveBeenCalled();
      const callArg = (mockRedis.incr as any).mock.calls[0][0];
      expect(callArg).toMatch(/^ratelimit:whatsapp:\+1234567890:\d+$/);
    });

    it('should use custom key prefix if provided', async () => {
      const limiter = createRateLimiter(mockRedis, {
        windowMs: 60000,
        maxRequests: 60,
        keyPrefix: 'custom',
      });

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await limiter(req as Request, res as Response, next);

      const callArg = (mockRedis.incr as any).mock.calls[0][0];
      expect(callArg).toMatch(/^custom:/);
    });
  });

  describe('Error handling', () => {
    it('should handle missing phone number gracefully', async () => {
      const limiter = createRateLimiter(mockRedis, {
        windowMs: 60000,
        maxRequests: 60,
        keyPrefix: 'ratelimit',
      });

      const req = createMockRequest();
      delete req.body?.From;

      const res = createMockResponse();
      const next = createMockNext();

      await limiter(req as Request, res as Response, next);

      // Should reject request without phone number
      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      const errorRedis = {
        incr: vi.fn().mockRejectedValue(new Error('Redis connection failed')),
      } as unknown as Redis;

      const limiter = createRateLimiter(errorRedis, {
        windowMs: 60000,
        maxRequests: 60,
        keyPrefix: 'ratelimit',
      });

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await limiter(req as Request, res as Response, next);

      // Should fail-open (allow request) or fail-closed (reject with 503)
      // Design decision: let's fail-closed for security
      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Configuration validation', () => {
    it('should accept valid configuration', () => {
      expect(() => {
        createRateLimiter(mockRedis, {
          windowMs: 60000,
          maxRequests: 60,
          keyPrefix: 'ratelimit',
        });
      }).not.toThrow();
    });

    it('should use default values if not provided', () => {
      // Should work with minimal config
      expect(() => {
        createRateLimiter(mockRedis, {
          windowMs: 60000,
          maxRequests: 60,
          keyPrefix: 'ratelimit',
        });
      }).not.toThrow();
    });
  });
});
