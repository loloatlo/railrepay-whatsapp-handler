/**
 * Webhook Route Unit Tests
 *
 * TDD FIRST - These tests written BEFORE implementation
 * Tests Twilio webhook endpoint with middleware chain
 *
 * Requirements:
 * - POST /webhook/twilio
 * - Apply middleware: twilio-signature, rate-limiter, correlation-id
 * - Parse form-urlencoded body (Twilio format)
 * - Check idempotency (MessageSid in Redis, 24hr TTL)
 * - Extract: MessageSid, From, To, Body, NumMedia, MediaUrl0
 * - Route to FSM handler based on user state
 * - Return TwiML response
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import type Redis from 'ioredis';
import type { Pool } from 'pg';

// Mock dependencies
vi.mock('../../../src/middleware/twilio-signature.js', () => ({
  validateTwilioSignature: () => (_req: any, _res: any, next: any) => next(),
}));

// Mock message formatter
vi.mock('../../../src/services/message-formatter.service.js', () => ({
  MessageFormatterService: class {
    formatTwiML(body: string) {
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message><Body>${body}</Body></Message>
</Response>`;
    }
    getTemplate(name: string) {
      return `Template: ${name}`;
    }
  },
}));

// Mock FSM service
vi.mock('../../../src/services/fsm.service.js', () => ({
  FsmService: class {
    async getState(_phoneNumber: string) {
      return { state: 'START', data: {} };
    }
    async setState(_phoneNumber: string, _state: string, _data: any) {}
  },
  FSMState: {
    START: 'START',
    AWAITING_TERMS: 'AWAITING_TERMS',
    AUTHENTICATED: 'AUTHENTICATED',
  },
}));

// Mock handlers
vi.mock('../../../src/handlers/index.js', () => ({
  getHandler: vi.fn(() => async () => ({
    response: 'Welcome message',
    nextState: undefined,
  })),
}));

// Mock repositories
vi.mock('../../../src/db/repositories/user.repository.js', () => ({
  UserRepository: class {
    async findByPhone(_phone: string) {
      return null;
    }
  },
}));

vi.mock('../../../src/db/repositories/outbox.repository.js', () => ({
  OutboxRepository: class {
    async insertEvent(_event: any) {}
  },
}));

const createMockRedis = (): Redis => {
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
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async () => 60),
    _store: store,
  } as unknown as Redis;
};

const createMockDbPool = (): Pool => {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: vi.fn(),
    end: vi.fn(),
  } as unknown as Pool;
};

describe('Webhook Route', () => {
  let app: Express;
  let mockRedis: Redis;
  let mockDbPool: Pool;

  beforeEach(async () => {
    vi.resetModules();
    mockRedis = createMockRedis();
    mockDbPool = createMockDbPool();

    // Create Express app with webhook route
    const express = await import('express');
    app = express.default();
    app.use(express.default.json());
    app.use(express.default.urlencoded({ extended: true }));

    // Import and mount webhook router
    const { createWebhookRouter } = await import('../../../src/routes/webhook.js');
    const webhookRouter = createWebhookRouter(mockRedis, mockDbPool);
    app.use('/webhook', webhookRouter);
  });

  describe('POST /webhook/twilio', () => {
    it('should return 200 OK for valid webhook request', async () => {
      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123456789',
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'Hello',
          NumMedia: '0',
        });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/xml');
    });

    it('should return TwiML response', async () => {
      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123456789',
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'Hello',
          NumMedia: '0',
        });

      expect(response.text).toContain('<Response>');
      expect(response.text).toContain('</Response>');
      expect(response.text).toContain('<Message>');
    });

    it('should extract MessageSid from request', async () => {
      const messageSid = 'SM987654321';

      await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: messageSid,
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'Test',
          NumMedia: '0',
        });

      // Verify idempotency key was checked
      expect(mockRedis.get).toHaveBeenCalledWith(
        expect.stringMatching(/idempotent:SM987654321/)
      );
    });

    it('should extract phone number from From field', async () => {
      const phoneNumber = 'whatsapp:+447700900999';

      await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: phoneNumber,
          To: 'whatsapp:+447700900123',
          Body: 'Test',
          NumMedia: '0',
        });

      // Phone number should be used for rate limiting
      expect(mockRedis.incr).toHaveBeenCalledWith(
        expect.stringMatching(/ratelimit:whatsapp:\+447700900999/)
      );
    });

    it('should extract message body', async () => {
      const messageBody = 'YES';

      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: messageBody,
          NumMedia: '0',
        });

      expect(response.status).toBe(200);
      // Body should be processed by FSM handler
    });
  });

  describe('Idempotency handling', () => {
    it('should return 200 OK for duplicate MessageSid (idempotent)', async () => {
      const messageSid = 'SM_DUPLICATE_TEST';

      // First request
      await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: messageSid,
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'First',
          NumMedia: '0',
        });

      // Mark as processed in mock Redis
      (mockRedis._store as Map<string, any>).set(`idempotent:${messageSid}`, {
        value: '1',
        expiry: Date.now() + 86400000,
      });

      // Second request with same MessageSid
      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: messageSid,
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'Second',
          NumMedia: '0',
        });

      expect(response.status).toBe(200);
      expect(response.text).toContain('<Response>');
    });

    it('should set idempotency key with 24hr TTL', async () => {
      const messageSid = 'SM_NEW_MESSAGE';

      await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: messageSid,
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'Test',
          NumMedia: '0',
        });

      // Verify Redis setex was called with 24hr TTL (86400 seconds)
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `idempotent:${messageSid}`,
        86400,
        '1'
      );
    });
  });

  describe('Rate limiting integration', () => {
    it('should apply rate limiter middleware', async () => {
      const phoneNumber = 'whatsapp:+1111111111';

      await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: phoneNumber,
          To: 'whatsapp:+447700900123',
          Body: 'Test',
          NumMedia: '0',
        });

      // Rate limiter should increment counter
      expect(mockRedis.incr).toHaveBeenCalled();
    });

    it('should return 429 when rate limit exceeded', async () => {
      const phoneNumber = 'whatsapp:+2222222222';

      // Simulate rate limit exceeded by making counter high
      const rateLimitKey = `ratelimit:${phoneNumber}:${Math.floor(Date.now() / 60000) * 60000}`;
      (mockRedis._store as Map<string, any>).set(rateLimitKey, {
        value: '61', // Over limit of 60
        expiry: Date.now() + 60000,
      });

      // Mock incr to return high value
      (mockRedis.incr as any).mockResolvedValueOnce(61);

      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: phoneNumber,
          To: 'whatsapp:+447700900123',
          Body: 'Test',
          NumMedia: '0',
        });

      expect(response.status).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
    });
  });

  describe('Correlation ID integration', () => {
    it('should add X-Correlation-ID to response', async () => {
      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'Test',
          NumMedia: '0',
        });

      expect(response.headers['x-correlation-id']).toBeDefined();
    });

    it('should use existing correlation ID if provided', async () => {
      const existingId = 'test-correlation-id-123';

      const response = await request(app)
        .post('/webhook/twilio')
        .set('X-Correlation-ID', existingId)
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'Test',
          NumMedia: '0',
        });

      expect(response.headers['x-correlation-id']).toBe(existingId);
    });
  });

  describe('Error handling', () => {
    it('should return 400 for missing MessageSid', async () => {
      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          // Missing MessageSid
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'Test',
          NumMedia: '0',
        });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing From field', async () => {
      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          // Missing From
          To: 'whatsapp:+447700900123',
          Body: 'Test',
          NumMedia: '0',
        });

      expect(response.status).toBe(400);
    });

    it('should handle Redis errors gracefully', async () => {
      // Make Redis.get throw error
      (mockRedis.get as any).mockRejectedValueOnce(new Error('Redis connection failed'));

      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'Test',
          NumMedia: '0',
        });

      // Should return error response but not crash
      expect([500, 503]).toContain(response.status);
    });
  });

  describe('Media handling', () => {
    it('should extract NumMedia field', async () => {
      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: '',
          NumMedia: '1',
          MediaUrl0: 'https://example.com/image.jpg',
          MediaContentType0: 'image/jpeg',
        });

      expect(response.status).toBe(200);
    });

    it('should extract MediaUrl0 when media is attached', async () => {
      const mediaUrl = 'https://api.twilio.com/media/ME123.jpg';

      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: '',
          NumMedia: '1',
          MediaUrl0: mediaUrl,
          MediaContentType0: 'image/jpeg',
        });

      expect(response.status).toBe(200);
      // MediaUrl should be processed by handler
    });
  });

  describe('FSM integration', () => {
    it('should route message to FSM handler', async () => {
      const response = await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+447700900123',
          Body: 'YES',
          NumMedia: '0',
        });

      expect(response.status).toBe(200);
      // FSM getState should have been called
    });
  });

  describe('TD-WHATSAPP-038: stateData in Handler Context', () => {
    it('should pass stateData from FSM to handler context', async () => {
      /**
       * TD CONTEXT: webhook.ts retrieves FSM state via fsmService.getState() which returns { state, data }
       * REQUIRED FIX: HandlerContext must include stateData property populated from currentState.data
       *
       * This test verifies the fix for TD-WHATSAPP-038 where handlers like routing-suggestion.handler
       * need access to state data (journeyId, origin, destination, etc.) but it was never passed
       */
      // Import getHandler to check handler context
      const { getHandler } = await import('../../../src/handlers/index.js');
      const mockHandler = vi.fn().mockResolvedValue({
        response: 'Test response',
        nextState: undefined,
      });
      (getHandler as any).mockReturnValue(mockHandler);

      // Import FsmService to mock getState return value
      const { FsmService } = await import('../../../src/services/fsm.service.js');
      const mockGetState = vi.fn().mockResolvedValue({
        state: 'AWAITING_ROUTING_CONFIRM',
        data: {
          journeyId: 'journey-abc123',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        },
      });
      vi.spyOn(FsmService.prototype, 'getState').mockImplementation(mockGetState);

      await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM_STATEDATA_TEST',
          From: 'whatsapp:+447700900123',
          To: 'whatsapp:+447700900000',
          Body: 'YES',
          NumMedia: '0',
        });

      // Verify handler received stateData in context
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: '+447700900123',
          messageBody: 'YES',
          currentState: 'AWAITING_ROUTING_CONFIRM',
          stateData: {
            journeyId: 'journey-abc123',
            origin: 'PAD',
            destination: 'CDF',
            travelDate: '2024-12-20',
            departureTime: '10:00',
          },
        }),
        expect.anything()
      );
    });

    it('should pass empty object for stateData when FSM returns no data', async () => {
      const { getHandler } = await import('../../../src/handlers/index.js');
      const mockHandler = vi.fn().mockResolvedValue({
        response: 'Test response',
        nextState: undefined,
      });
      (getHandler as any).mockReturnValue(mockHandler);

      const { FsmService } = await import('../../../src/services/fsm.service.js');
      const mockGetState = vi.fn().mockResolvedValue({
        state: 'START',
        data: {}, // No data for START state
      });
      vi.spyOn(FsmService.prototype, 'getState').mockImplementation(mockGetState);

      await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM_EMPTY_STATEDATA',
          From: 'whatsapp:+447700900999',
          To: 'whatsapp:+447700900000',
          Body: 'Hello',
          NumMedia: '0',
        });

      // Verify handler received empty stateData
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          stateData: {},
        }),
        expect.anything()
      );
    });
  });

  describe('Phone number normalization', () => {
    it('should strip whatsapp: prefix from phone number for handler context', async () => {
      // Import getHandler to check what phone number was passed
      const { getHandler } = await import('../../../src/handlers/index.js');
      const mockHandler = vi.fn().mockResolvedValue({
        response: 'Test response',
        nextState: undefined,
      });
      (getHandler as any).mockReturnValue(mockHandler);

      await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM123',
          From: 'whatsapp:+447700900123',
          To: 'whatsapp:+447700900000',
          Body: 'Hi',
          NumMedia: '0',
        });

      // Verify handler was called with E.164 format (no whatsapp: prefix)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: '+447700900123', // NOT "whatsapp:+447700900123"
        }),
        expect.anything()
      );
    });

    it('should handle phone number without whatsapp: prefix', async () => {
      const { getHandler } = await import('../../../src/handlers/index.js');
      const mockHandler = vi.fn().mockResolvedValue({
        response: 'Test response',
        nextState: undefined,
      });
      (getHandler as any).mockReturnValue(mockHandler);

      await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM456',
          From: '+447700900123', // Already E.164 format
          To: 'whatsapp:+447700900000',
          Body: 'Hi',
          NumMedia: '0',
        });

      // Should pass through unchanged
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: '+447700900123',
        }),
        expect.anything()
      );
    });

    it('should handle sms: prefix from Twilio SMS', async () => {
      const { getHandler } = await import('../../../src/handlers/index.js');
      const mockHandler = vi.fn().mockResolvedValue({
        response: 'Test response',
        nextState: undefined,
      });
      (getHandler as any).mockReturnValue(mockHandler);

      await request(app)
        .post('/webhook/twilio')
        .type('form')
        .send({
          MessageSid: 'SM789',
          From: 'sms:+447700900123',
          To: 'whatsapp:+447700900000',
          Body: 'Hi',
          NumMedia: '0',
        });

      // Should strip sms: prefix too
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: '+447700900123',
        }),
        expect.anything()
      );
    });
  });
});
