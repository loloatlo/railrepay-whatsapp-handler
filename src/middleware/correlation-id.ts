/**
 * Correlation ID Middleware
 *
 * Extracts or generates correlation IDs for distributed tracing
 *
 * Requirements:
 * - Extract X-Correlation-ID from incoming request header
 * - Generate UUID v4 if not present
 * - Attach to request object (req.correlationId)
 * - Add to response header (X-Correlation-ID)
 *
 * ADR Compliance:
 * - ADR-002: Correlation IDs required for distributed tracing across services
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';

/**
 * Extended Request interface with correlationId
 */
export interface RequestWithCorrelationId extends Request {
  correlationId: string;
}

/**
 * Creates correlation ID middleware
 *
 * Extracts X-Correlation-ID header or generates new UUID v4.
 * Attaches correlationId to request object and response header.
 *
 * @returns Express middleware function
 */
export function correlationIdMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Extract correlation ID from header (Express lowercases all headers)
    // Try lowercase first, then check all headers for case-insensitive match
    let headerValue = req.headers['x-correlation-id'];

    // If not found in lowercase, search case-insensitively
    if (!headerValue) {
      const headerKey = Object.keys(req.headers).find(
        key => key.toLowerCase() === 'x-correlation-id'
      );
      if (headerKey) {
        headerValue = req.headers[headerKey];
      }
    }

    const existingId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    // Use existing ID if present and non-empty, otherwise generate new UUID v4
    const correlationId = existingId?.trim() || randomUUID();

    // Attach to request object
    (req as RequestWithCorrelationId).correlationId = correlationId;

    // Add to response header
    res.set('X-Correlation-ID', correlationId);

    // Continue to next middleware
    next();
  };
}
