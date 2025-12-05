/**
 * Twilio Signature Validation Middleware
 * Per specification §3.1: MANDATORY signature validation for all incoming webhooks
 * Per specification §6.3: Security - Twilio webhook signature validation
 *
 * CRITICAL SECURITY COMPONENT
 * This middleware MUST be applied to all Twilio webhook endpoints
 */

import type { Request, Response, NextFunction } from 'express';
// Twilio is a CommonJS module - must use default import in ESM
import twilio from 'twilio';
const { validateRequest } = twilio;
import { getLogger } from '../lib/logger.js';

const logger = getLogger();

/**
 * Create Twilio signature validation middleware
 *
 * Per Twilio security best practices:
 * 1. Extract X-Twilio-Signature header
 * 2. Reconstruct the full URL (protocol + host + path)
 * 3. Pass request params (body) to validateRequest
 * 4. Use Twilio auth token for HMAC validation
 *
 * @param authToken - Twilio auth token from TWILIO_AUTH_TOKEN env var
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * import { validateTwilioSignature } from './middleware/twilio-signature.js';
 *
 * const authToken = process.env.TWILIO_AUTH_TOKEN!;
 *
 * app.post(
 *   '/webhook/twilio',
 *   validateTwilioSignature(authToken), // MANDATORY security check
 *   async (req, res) => {
 *     // Handle verified webhook
 *   }
 * );
 * ```
 */
export function validateTwilioSignature(authToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Extract signature from header
      const signature = req.header('X-Twilio-Signature');

      if (!signature || signature.trim() === '') {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing Twilio signature header (X-Twilio-Signature)',
        });
        return;
      }

      // Reconstruct full URL for validation
      // Per Twilio docs: Must match exact URL Twilio called
      // IMPORTANT: Behind reverse proxy (Railway), we must use X-Forwarded-* headers
      // to get the original protocol/host that Twilio used to sign the request
      const protocol = req.get('X-Forwarded-Proto') || req.protocol; // 'https' from proxy
      const host = req.get('X-Forwarded-Host') || req.get('host'); // External hostname
      const url = `${protocol}://${host}${req.originalUrl}`;

      // Get request params (body for POST requests)
      const params = req.body || {};

      // Validate signature using Twilio SDK
      const isValid = validateRequest(authToken, signature, url, params);

      if (!isValid) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid Twilio signature - request rejected',
        });
        return;
      }

      // Signature valid - proceed to route handler
      next();
    } catch (error) {
      // Log error but don't expose internals to client
      const correlationId = (req as any).correlationId || 'unknown';
      logger.error('Twilio signature validation error', {
        component: 'whatsapp-handler/twilio-signature',
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Signature validation failed',
      });
    }
  };
}
