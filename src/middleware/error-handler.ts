/**
 * Error Handler Middleware
 *
 * Centralized error handling for Express application
 *
 * Requirements:
 * - Catch all unhandled errors
 * - Log error with correlation ID
 * - Return appropriate HTTP status code
 * - Return TwiML error response for webhook errors
 * - Don't expose internal error details in production
 *
 * ADR Compliance:
 * - ADR-002: Log errors with correlation IDs for distributed tracing
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { getLogger } from '../lib/logger.js';

const logger = getLogger();

/**
 * Extended Error interface with operational flag
 */
export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

/**
 * Determines if the request is for a webhook endpoint
 */
function isWebhookRoute(req: Request): boolean {
  return req.path.startsWith('/webhook');
}

/**
 * Sanitizes error message to avoid leaking internal details
 */
function sanitizeErrorMessage(error: any, isDevelopment: boolean): string {
  if (!error) {
    return 'An unknown error occurred';
  }

  const originalMessage = error.message || 'An unknown error occurred';

  // In production, sanitize messages that might leak internal details
  if (!isDevelopment) {
    // Remove database connection strings, file paths, etc.
    const sanitized = originalMessage
      .replace(/localhost:\d+/g, '[redacted]')
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[redacted]')
      .replace(/ECONNREFUSED/g, 'Connection failed')
      .replace(/\/[\w\/\-\.]+/g, '[path]'); // Remove file paths

    // If message contains technical details, use generic message
    if (sanitized.includes('[redacted]') || sanitized.includes('[path]')) {
      return 'An internal error occurred. Please try again later.';
    }

    return sanitized;
  }

  return originalMessage;
}

/**
 * Formats TwiML error response for Twilio webhook
 */
function formatTwiMLError(_message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, we encountered an error processing your message. Please try again later.</Message>
</Response>`;
}

/**
 * Creates error handler middleware
 *
 * This is an ErrorRequestHandler (4 parameters) that catches all errors
 * thrown by route handlers and middleware.
 *
 * @returns Express error handler middleware
 */
export function errorHandler(): ErrorRequestHandler {
  return (
    err: any,
    req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    // Extract correlation ID from request
    const correlationId = (req as any).correlationId || 'unknown';

    // Determine status code
    const statusCode = err?.statusCode || 500;

    // Determine if we're in development
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Log error with correlation ID (ADR-002)
    logger.error('Request error', {
      component: 'whatsapp-handler/error-handler',
      correlationId,
      message: err?.message || 'Unknown error',
      statusCode,
      path: req.path,
      method: req.method,
      stack: err?.stack,
    });

    // Set status code
    res.status(statusCode);

    // Handle webhook routes with TwiML
    if (isWebhookRoute(req)) {
      const errorMessage = sanitizeErrorMessage(err, isDevelopment);
      const twiml = formatTwiMLError(errorMessage);

      res.type('text/xml').send(twiml);
      return;
    }

    // Handle API routes with JSON
    const sanitizedMessage = sanitizeErrorMessage(err, isDevelopment);

    const errorResponse: any = {
      error: err?.name || 'Error',
      message: sanitizedMessage,
      correlationId,
    };

    // Include stack trace only in development
    if (isDevelopment && err?.stack) {
      errorResponse.stack = err.stack;
    }

    res.json(errorResponse);
  };
}
