/**
 * Correlation ID Middleware Unit Tests
 *
 * TDD FIRST - These tests written BEFORE implementation
 * Tests correlation ID extraction, generation, and propagation
 *
 * Requirements:
 * - Extract X-Correlation-ID from incoming request header
 * - Generate UUID v4 if not present
 * - Attach to request object (req.correlationId)
 * - Add to response header (X-Correlation-ID)
 *
 * ADR Compliance:
 * - ADR-002: Correlation IDs required for distributed tracing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const createMockRequest = (correlationId?: string): Partial<Request> => ({
  headers: correlationId ? { 'x-correlation-id': correlationId } : {},
  body: {},
});

const createMockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {
    set: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  return res;
};

const createMockNext = (): NextFunction => vi.fn();

// UUID v4 regex pattern
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('Correlation ID Middleware', () => {
  let correlationIdMiddleware: any;

  beforeEach(async () => {
    vi.resetModules();
    // Dynamic import to get fresh module
    const module = await import('../../../src/middleware/correlation-id.js');
    correlationIdMiddleware = module.correlationIdMiddleware;
  });

  describe('Header extraction', () => {
    it('should use existing X-Correlation-ID header if present', () => {
      const existingId = '123e4567-e89b-12d3-a456-426614174000';
      const middleware = correlationIdMiddleware();

      const req = createMockRequest(existingId) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      expect((req as any).correlationId).toBe(existingId);
      expect(next).toHaveBeenCalled();
    });

    it('should handle case-insensitive header names', () => {
      const existingId = '123e4567-e89b-12d3-a456-426614174000';
      const middleware = correlationIdMiddleware();

      const req = {
        headers: { 'X-CORRELATION-ID': existingId },
        body: {},
      } as unknown as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      expect((req as any).correlationId).toBe(existingId);
    });
  });

  describe('UUID generation', () => {
    it('should generate UUID v4 if header missing', () => {
      const middleware = correlationIdMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      expect((req as any).correlationId).toBeDefined();
      expect((req as any).correlationId).toMatch(UUID_V4_PATTERN);
      expect(next).toHaveBeenCalled();
    });

    it('should generate different UUIDs for different requests', () => {
      const middleware = correlationIdMiddleware();

      const req1 = createMockRequest() as Request;
      const req2 = createMockRequest() as Request;

      middleware(req1, createMockResponse() as Response, createMockNext());
      middleware(req2, createMockResponse() as Response, createMockNext());

      expect((req1 as any).correlationId).not.toBe((req2 as any).correlationId);
    });

    it('should generate valid UUID v4 format', () => {
      const middleware = correlationIdMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      const correlationId = (req as any).correlationId;
      expect(correlationId).toMatch(UUID_V4_PATTERN);

      // UUID v4 has specific version bits
      const parts = correlationId.split('-');
      expect(parts[2][0]).toBe('4'); // Version 4
      expect(['8', '9', 'a', 'b']).toContain(parts[3][0].toLowerCase()); // Variant
    });
  });

  describe('Request attachment', () => {
    it('should attach correlationId to request object', () => {
      const middleware = correlationIdMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      expect((req as any).correlationId).toBeUndefined();

      middleware(req, res, next);

      expect((req as any).correlationId).toBeDefined();
      expect(typeof (req as any).correlationId).toBe('string');
    });

    it('should make correlationId available for downstream middleware', () => {
      const middleware = correlationIdMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      // Simulate downstream middleware accessing correlationId
      const downstreamMiddleware = (req: Request) => {
        return (req as any).correlationId;
      };

      const retrievedId = downstreamMiddleware(req);
      expect(retrievedId).toBeDefined();
      expect(retrievedId).toMatch(UUID_V4_PATTERN);
    });
  });

  describe('Response header', () => {
    it('should add correlationId to response header', () => {
      const middleware = correlationIdMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      expect(res.set).toHaveBeenCalledWith(
        'X-Correlation-ID',
        (req as any).correlationId
      );
    });

    it('should echo back existing correlation ID in response header', () => {
      const existingId = '123e4567-e89b-12d3-a456-426614174000';
      const middleware = correlationIdMiddleware();

      const req = createMockRequest(existingId) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      expect(res.set).toHaveBeenCalledWith('X-Correlation-ID', existingId);
    });

    it('should add generated correlation ID to response header', () => {
      const middleware = correlationIdMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      const generatedId = (req as any).correlationId;
      expect(res.set).toHaveBeenCalledWith('X-Correlation-ID', generatedId);
    });
  });

  describe('Middleware flow', () => {
    it('should call next() to continue middleware chain', () => {
      const middleware = correlationIdMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('should not throw errors', () => {
      const middleware = correlationIdMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      expect(() => {
        middleware(req, res, next);
      }).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string header gracefully', () => {
      const middleware = correlationIdMiddleware();

      const req = createMockRequest('') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      // Should generate new UUID for empty string
      expect((req as any).correlationId).toBeDefined();
      expect((req as any).correlationId).toMatch(UUID_V4_PATTERN);
    });

    it('should handle whitespace-only header gracefully', () => {
      const middleware = correlationIdMiddleware();

      const req = createMockRequest('   ') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      // Should generate new UUID for whitespace
      expect((req as any).correlationId).toBeDefined();
      expect((req as any).correlationId).toMatch(UUID_V4_PATTERN);
    });

    it('should preserve valid non-UUID correlation IDs', () => {
      // Some systems use non-UUID correlation IDs
      const customId = 'trace-abc-123-xyz';
      const middleware = correlationIdMiddleware();

      const req = createMockRequest(customId) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      // Should preserve custom ID
      expect((req as any).correlationId).toBe(customId);
    });
  });

  describe('TypeScript type augmentation', () => {
    it('should allow TypeScript to recognize correlationId on Request', () => {
      // This is a compile-time check, but we can verify runtime behavior
      const middleware = correlationIdMiddleware();

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware(req, res, next);

      // TypeScript should recognize this property after middleware runs
      const id: string = (req as any).correlationId;
      expect(typeof id).toBe('string');
    });
  });
});
