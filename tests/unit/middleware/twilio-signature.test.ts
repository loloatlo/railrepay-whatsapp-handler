/**
 * Unit tests for Twilio signature validation middleware
 * Tests FIRST (TDD per ADR-014)
 *
 * CRITICAL SECURITY COMPONENT
 * Per specification §3.1: MANDATORY signature validation for all incoming webhooks
 * Per specification §6.3: Security - Twilio webhook signature validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock twilio module (CommonJS module with default export)
const mockValidateRequest = vi.fn();
vi.mock('twilio', () => ({
  default: {
    validateRequest: mockValidateRequest,
  },
}));

describe('Twilio Signature Validation Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      header: vi.fn(),
      protocol: 'https',
      get: vi.fn((name: string) => {
        if (name === 'host') return 'whatsapp-handler.railway.app';
        return undefined;
      }),
      originalUrl: '/webhook/twilio',
      body: {
        MessageSid: 'SM1234567890',
        From: 'whatsapp:+447700900123',
        To: 'whatsapp:+14155238886',
        Body: 'Hello',
      },
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe('validateTwilioSignature', () => {
    it('should call next() when signature is valid', async () => {
      // Arrange
      const { validateTwilioSignature } = await import('../../../src/middleware/twilio-signature.js');
      const validSignature = 'valid-twilio-signature-hash';
      (mockReq.header as any).mockReturnValue(validSignature);
      mockValidateRequest.mockReturnValue(true); // Twilio validates successfully

      const authToken = 'test-auth-token';
      const middleware = validateTwilioSignature(authToken);

      // Act
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockValidateRequest).toHaveBeenCalledWith(
        authToken,
        validSignature,
        expect.stringContaining('https://whatsapp-handler.railway.app/webhook/twilio'),
        mockReq.body
      );
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 401 when signature is invalid', async () => {
      // Arrange
      const { validateTwilioSignature } = await import('../../../src/middleware/twilio-signature.js');
      const invalidSignature = 'invalid-signature';
      (mockReq.header as any).mockReturnValue(invalidSignature);
      mockValidateRequest.mockReturnValue(false); // Twilio validation fails

      const authToken = 'test-auth-token';
      const middleware = validateTwilioSignature(authToken);

      // Act
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockValidateRequest).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: expect.stringContaining('Invalid Twilio signature'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when signature header is missing', async () => {
      // Arrange
      const { validateTwilioSignature } = await import('../../../src/middleware/twilio-signature.js');
      (mockReq.header as any).mockReturnValue(undefined); // No signature header

      const authToken = 'test-auth-token';
      const middleware = validateTwilioSignature(authToken);

      // Act
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: expect.stringContaining('Missing Twilio signature'),
        })
      );
      expect(mockValidateRequest).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should construct correct URL for signature validation', async () => {
      // Arrange
      const { validateTwilioSignature } = await import('../../../src/middleware/twilio-signature.js');
      const validSignature = 'valid-signature';
      (mockReq.header as any).mockReturnValue(validSignature);
      mockValidateRequest.mockReturnValue(true);

      const authToken = 'test-auth-token';
      const middleware = validateTwilioSignature(authToken);

      // Act
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      const callArgs = mockValidateRequest.mock.calls[0];
      const url = callArgs[2];
      expect(url).toBe('https://whatsapp-handler.railway.app/webhook/twilio');
      expect(url).toContain(mockReq.protocol);
      expect(url).toContain(mockReq.originalUrl);
    });

    it('should pass request body params to Twilio validator', async () => {
      // Arrange
      const { validateTwilioSignature } = await import('../../../src/middleware/twilio-signature.js');
      const validSignature = 'valid-signature';
      (mockReq.header as any).mockReturnValue(validSignature);
      mockValidateRequest.mockReturnValue(true);

      const authToken = 'test-auth-token';
      const middleware = validateTwilioSignature(authToken);

      // Act
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      const callArgs = mockValidateRequest.mock.calls[0];
      const params = callArgs[3];
      expect(params).toEqual(mockReq.body);
      expect(params).toHaveProperty('MessageSid');
      expect(params).toHaveProperty('From');
      expect(params).toHaveProperty('Body');
    });

    it('should handle validation errors gracefully', async () => {
      // Arrange
      const { validateTwilioSignature } = await import('../../../src/middleware/twilio-signature.js');
      const validSignature = 'valid-signature';
      (mockReq.header as any).mockReturnValue(validSignature);
      mockValidateRequest.mockImplementation(() => {
        throw new Error('Twilio validation error');
      });

      const authToken = 'test-auth-token';
      const middleware = validateTwilioSignature(authToken);

      // Act
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('security edge cases', () => {
    it('should reject empty signature string', async () => {
      // Arrange
      const { validateTwilioSignature } = await import('../../../src/middleware/twilio-signature.js');
      (mockReq.header as any).mockReturnValue(''); // Empty string

      const authToken = 'test-auth-token';
      const middleware = validateTwilioSignature(authToken);

      // Act
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should use exact URL match (no trailing slashes allowed)', async () => {
      // Arrange
      const { validateTwilioSignature } = await import('../../../src/middleware/twilio-signature.js');
      mockReq.originalUrl = '/webhook/twilio/'; // Trailing slash
      const validSignature = 'valid-signature';
      (mockReq.header as any).mockReturnValue(validSignature);
      mockValidateRequest.mockReturnValue(true);

      const authToken = 'test-auth-token';
      const middleware = validateTwilioSignature(authToken);

      // Act
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      const url = mockValidateRequest.mock.calls[0][2];
      expect(url).toBe('https://whatsapp-handler.railway.app/webhook/twilio/');
      // Twilio validation should use exact URL including trailing slash
    });
  });
});
