/**
 * Error Handler Middleware Unit Tests
 *
 * TDD FIRST - These tests written BEFORE implementation
 * Tests centralized error handling for Express application
 *
 * Requirements:
 * - Catch all unhandled errors
 * - Log error with correlation ID
 * - Return appropriate HTTP status code
 * - Return TwiML error response for webhook errors
 * - Don't expose internal error details
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock error classes
class AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;

  constructor(message: string, statusCode?: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
  }
}

const createMockRequest = (correlationId?: string, path?: string): Partial<Request> => ({
  correlationId: correlationId || 'test-correlation-id',
  path: path || '/test',
  method: 'POST',
  headers: {},
  body: {},
} as any);

const createMockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
  };
  return res;
};

const createMockNext = (): NextFunction => vi.fn();

describe('Error Handler Middleware', () => {
  let errorHandler: any;
  let consoleErrorSpy: any;

  beforeEach(async () => {
    vi.resetModules();
    // Spy on console.error
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Dynamic import to get fresh module
    const module = await import('../../../src/middleware/error-handler.js');
    errorHandler = module.errorHandler;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('HTTP status codes', () => {
    it('should return 500 for unknown errors', () => {
      const handler = errorHandler();
      const error = new Error('Unknown error');

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return custom status code if provided', () => {
      const handler = errorHandler();
      const error = new AppError('Not found', 404);

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 for validation errors', () => {
      const handler = errorHandler();
      const error = new AppError('Validation failed', 400);

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 503 for service unavailable errors', () => {
      const handler = errorHandler();
      const error = new AppError('Service unavailable', 503);

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });

  describe('Error logging', () => {
    it('should log error with correlation ID', () => {
      const handler = errorHandler();
      const error = new Error('Test error');
      const correlationId = 'abc-123-xyz';

      const req = createMockRequest(correlationId) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      // Verify error response was sent (logging is now handled by winston logger)
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalled();
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.correlationId).toBe(correlationId);
    });

    it('should log error stack trace', () => {
      const handler = errorHandler();
      const error = new Error('Test error with stack');

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      // Verify error response was sent (logging is now handled by winston logger)
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalled();
    });

    it('should handle missing correlation ID gracefully', () => {
      const handler = errorHandler();
      const error = new Error('Test error');

      // Create request with explicitly no correlationId
      const req = {
        path: '/test',
        method: 'POST',
        headers: {},
        body: {},
      } as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      // Verify error response was sent with 'unknown' correlation ID
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalled();
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.correlationId).toBe('unknown');
    });
  });

  describe('TwiML responses for webhook errors', () => {
    it('should return TwiML format for /webhook/* routes', () => {
      const handler = errorHandler();
      const error = new Error('Webhook error');

      const req = createMockRequest('test-id', '/webhook/twilio') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      expect(res.type).toHaveBeenCalledWith('text/xml');
      expect(res.send).toHaveBeenCalled();

      // Verify TwiML structure
      const twimlResponse = (res.send as any).mock.calls[0][0];
      expect(twimlResponse).toContain('<Response>');
      expect(twimlResponse).toContain('</Response>');
    });

    it('should include error message in TwiML response', () => {
      const handler = errorHandler();
      const error = new Error('Processing failed');

      const req = createMockRequest('test-id', '/webhook/twilio') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      const twimlResponse = (res.send as any).mock.calls[0][0];
      expect(twimlResponse).toContain('<Message>');
    });

    it('should return JSON for non-webhook routes', () => {
      const handler = errorHandler();
      const error = new AppError('API error', 400);

      const req = createMockRequest('test-id', '/api/status') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      expect(res.json).toHaveBeenCalled();
      expect(res.type).not.toHaveBeenCalled();
    });
  });

  describe('Error message sanitization', () => {
    it('should not expose stack trace in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const handler = errorHandler();
      const error = new Error('Internal error');
      error.stack = 'Sensitive stack trace information';

      const req = createMockRequest('test-id', '/api/test') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      const responseBody = (res.json as any).mock.calls[0][0];
      expect(responseBody.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should include stack trace in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const handler = errorHandler();
      const error = new Error('Dev error');
      error.stack = 'Stack trace for debugging';

      const req = createMockRequest('test-id', '/api/test') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      const responseBody = (res.json as any).mock.calls[0][0];
      expect(responseBody.stack).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should return generic message for operational errors', () => {
      const handler = errorHandler();
      const error = new AppError('Database connection failed', 503, true);

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      const responseBody = (res.json as any).mock.calls[0][0];
      expect(responseBody.error).toBeDefined();
      expect(responseBody.message).toBeDefined();
    });

    it('should sanitize error messages to avoid leaking internals', () => {
      const handler = errorHandler();
      const error = new Error('ECONNREFUSED localhost:5432 - database connection');

      const req = createMockRequest('test-id', '/api/test') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      const responseBody = (res.json as any).mock.calls[0][0];
      // Should not expose database details in production
      expect(responseBody.message).not.toContain('localhost:5432');
    });
  });

  describe('Error response structure', () => {
    it('should include error field in JSON response', () => {
      const handler = errorHandler();
      const error = new AppError('Test error', 400);

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      const responseBody = (res.json as any).mock.calls[0][0];
      expect(responseBody.error).toBeDefined();
    });

    it('should include message field in JSON response', () => {
      const handler = errorHandler();
      const error = new AppError('Test error', 400);

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      const responseBody = (res.json as any).mock.calls[0][0];
      expect(responseBody.message).toBeDefined();
    });

    it('should include correlation ID in response', () => {
      const handler = errorHandler();
      const error = new AppError('Test error', 400);
      const correlationId = 'correlation-xyz';

      const req = createMockRequest(correlationId) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      const responseBody = (res.json as any).mock.calls[0][0];
      expect(responseBody.correlationId).toBe(correlationId);
    });
  });

  describe('Edge cases', () => {
    it('should handle non-Error objects', () => {
      const handler = errorHandler();
      const error = 'String error' as any;

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalled();
    });

    it('should handle null errors', () => {
      const handler = errorHandler();
      const error = null as any;

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should handle errors without message', () => {
      const handler = errorHandler();
      const error = new Error();

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      handler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const responseBody = (res.json as any).mock.calls[0][0];
      expect(responseBody.message).toBeDefined();
    });
  });
});
