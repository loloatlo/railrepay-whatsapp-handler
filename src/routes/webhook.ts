/**
 * Webhook Route Handler
 *
 * Twilio WhatsApp webhook endpoint with full middleware chain
 *
 * Flow:
 * Request → Signature Validation → Rate Limit → Correlation ID →
 * Parse Body → Idempotency Check → Get User State → Call Handler → Return TwiML
 *
 * Requirements:
 * - POST /webhook/twilio
 * - Apply middleware: twilio-signature, rate-limiter, correlation-id
 * - Parse form-urlencoded body (Twilio format)
 * - Check idempotency (MessageSid in Redis, 24hr TTL)
 * - Extract: MessageSid, From, To, Body, NumMedia, MediaUrl0
 * - Route to FSM handler based on user state
 * - Return TwiML response
 *
 * ADR Compliance:
 * - ADR-002: Correlation IDs logged with all operations
 * - ADR-014: TDD implementation (tests written first)
 */

import { Router, type Request, Response, NextFunction } from 'express';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { createRateLimiter } from '../middleware/rate-limiter.js';
import { correlationIdMiddleware } from '../middleware/correlation-id.js';
import { validateTwilioSignature } from '../middleware/twilio-signature.js';
import { FsmService } from '../services/fsm.service.js';
import { MessageFormatterService } from '../services/message-formatter.service.js';
import { getHandler, type HandlerContext } from '../handlers/index.js';
import { UserRepository } from '../db/repositories/user.repository.js';
import { OutboxRepository } from '../db/repositories/outbox.repository.js';
import {
  messagesReceivedCounter,
  messagesSentCounter,
  webhookDurationHistogram,
} from './metrics.js';

/**
 * Twilio webhook request body structure
 */
interface TwilioWebhookBody {
  MessageSid: string;
  From: string; // E.g., "whatsapp:+447700900123"
  To: string;
  Body: string;
  NumMedia: string; // Number of media attachments
  MediaUrl0?: string; // URL of first media attachment
  MediaContentType0?: string; // Content type of first media
}

/**
 * Normalize Twilio phone number to E.164 format
 *
 * Twilio sends phone numbers with channel prefixes:
 * - WhatsApp: "whatsapp:+447700900123"
 * - SMS: "sms:+447700900123"
 * - Voice: "+447700900123" (no prefix)
 *
 * This function strips the prefix to get clean E.164 format
 * required for database storage and UserRepository validation.
 *
 * @param from - Twilio From field (e.g., "whatsapp:+447700900123")
 * @returns E.164 phone number (e.g., "+447700900123")
 */
function normalizePhoneNumber(from: string): string {
  // Strip whatsapp: or sms: prefix if present
  return from.replace(/^(whatsapp|sms):/, '');
}

/**
 * Create webhook router with dependencies injected
 *
 * @param redis - ioredis client for rate limiting, idempotency, and FSM state
 * @param dbPool - PostgreSQL connection pool
 * @returns Express router instance
 */
export function createWebhookRouter(redis: Redis, dbPool: Pool): Router {
  const router = Router();

  // Initialize services
  const fsmService = new FsmService(redis);
  const messageFormatter = new MessageFormatterService();
  const userRepository = new UserRepository(dbPool);
  const outboxRepository = new OutboxRepository(dbPool);

  // Apply middleware chain
  // 1. Twilio signature validation (security)
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  router.use(validateTwilioSignature(authToken));

  // 2. Rate limiting (60 req/min per phone number)
  router.use(
    createRateLimiter(redis, {
      windowMs: 60000, // 1 minute
      maxRequests: 60,
      keyPrefix: 'ratelimit',
    })
  );

  // 3. Correlation ID (distributed tracing)
  router.use(correlationIdMiddleware());

  /**
   * POST /webhook/twilio
   *
   * Main webhook endpoint for Twilio WhatsApp messages
   */
  router.post('/twilio', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Start timing for metrics
    const startTime = Date.now();

    try {
      const body: TwilioWebhookBody = req.body;

      // Validate required fields
      if (!body.MessageSid) {
        messagesReceivedCounter?.inc({ status: 'invalid' });
        res.status(400).json({
          error: 'Missing required field: MessageSid',
        });
        return;
      }

      if (!body.From) {
        messagesReceivedCounter?.inc({ status: 'invalid' });
        res.status(400).json({
          error: 'Missing required field: From',
        });
        return;
      }

      // Increment received counter
      messagesReceivedCounter?.inc({ status: 'received' });

      // Extract message details
      const messageSid = body.MessageSid;
      const phoneNumber = normalizePhoneNumber(body.From); // E.164: "+447700900123"
      const messageBody = body.Body || '';
      // const numMedia = parseInt(body.NumMedia || '0', 10);
      const mediaUrl = body.MediaUrl0;

      // Check idempotency (prevent duplicate processing)
      const idempotencyKey = `idempotent:${messageSid}`;
      const isProcessed = await redis.get(idempotencyKey);

      if (isProcessed) {
        // Message already processed - return success without re-processing
        messagesReceivedCounter?.inc({ status: 'duplicate' });
        const twiml = messageFormatter.formatTwiML('Message already processed');
        res.status(200).type('text/xml').send(twiml);
        return;
      }

      // Mark message as processed (24hr TTL)
      await redis.setex(idempotencyKey, 86400, '1');

      // Get current FSM state for user
      const currentState = await fsmService.getState(phoneNumber);

      // Get user record (if exists)
      const user = await userRepository.findByPhone(phoneNumber);

      // Get correlation ID from request
      const correlationId = (req as any).correlationId || 'unknown';

      // Build handler context
      const handlerContext: HandlerContext = {
        phoneNumber,
        messageBody,
        messageSid,
        mediaUrl,
        user,
        currentState: currentState.state,
        correlationId,
        stateData: currentState.data,
      };

      // Get and execute handler for current state
      const handler = getHandler(currentState.state);
      const handlerResult = await handler(handlerContext, userRepository);

      // Apply state transition if specified
      if (handlerResult.nextState) {
        await fsmService.setState(phoneNumber, handlerResult.nextState, handlerResult.stateData || {});
      }

      // Publish events to outbox if specified
      if (handlerResult.publishEvents && handlerResult.publishEvents.length > 0) {
        for (const event of handlerResult.publishEvents) {
          await outboxRepository.insertEvent(
            event.aggregate_id,
            event.aggregate_type as 'user' | 'journey' | 'claim',
            event.event_type,
            event.payload
          );
        }
      }

      // Format response as TwiML
      const twiml = messageFormatter.formatTwiML(handlerResult.response);

      // Increment sent counter
      messagesSentCounter?.inc({ status: 'success' });

      // Record webhook duration
      const durationSeconds = (Date.now() - startTime) / 1000;
      webhookDurationHistogram?.observe(durationSeconds);

      // Return TwiML response
      res.status(200).type('text/xml').send(twiml);
    } catch (error) {
      // Increment error counter
      messagesReceivedCounter?.inc({ status: 'error' });

      // Record webhook duration even on error
      const durationSeconds = (Date.now() - startTime) / 1000;
      webhookDurationHistogram?.observe(durationSeconds);

      // Pass error to error handler middleware
      next(error);
    }
  });

  return router;
}
