/**
 * Rate Limiter Middleware
 *
 * Redis-backed sliding window rate limiting for WhatsApp webhook
 *
 * Requirements:
 * - 60 requests per minute per phone number
 * - Sliding window algorithm using Redis
 * - Return 429 Too Many Requests when exceeded
 * - Include Retry-After header
 *
 * ADR Compliance:
 * - ADR-002: Logs should include correlation IDs
 *
 * TODO (TD-WHATSAPP-018): Migrate to node-redis v4 for @railrepay/redis-cache compatibility
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { getLogger } from '../lib/logger.js';

const logger = getLogger();

export interface RateLimiterOptions {
  windowMs: number;      // Time window in milliseconds (e.g., 60000 for 1 minute)
  maxRequests: number;   // Maximum requests per window
  keyPrefix: string;     // Redis key prefix (e.g., 'ratelimit')
}

/**
 * Creates a rate limiter middleware instance
 *
 * @param redis - Redis client instance (ioredis)
 * @param options - Rate limiter configuration
 * @returns Express middleware function
 */
export function createRateLimiter(
  redis: Redis,
  options: RateLimiterOptions
): RequestHandler {
  const { windowMs, maxRequests, keyPrefix } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Extract phone number from Twilio request body
      const phoneNumber = req.body?.From;

      if (!phoneNumber) {
        res.status(400).json({
          error: 'Missing phone number in request',
        });
        return;
      }

      // Calculate current window start (aligned to windowMs intervals)
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;

      // Create Redis key: ratelimit:{phoneNumber}:{windowStart}
      const redisKey = `${keyPrefix}:${phoneNumber}:${windowStart}`;

      // Increment counter for this window
      const currentCount = await redis.incr(redisKey);

      // Set TTL on first increment (when count is 1)
      if (currentCount === 1) {
        // Set expiry to window duration + small buffer
        const ttlSeconds = Math.ceil(windowMs / 1000) + 10;
        await redis.expire(redisKey, ttlSeconds);
      }

      // Check if limit exceeded
      if (currentCount > maxRequests) {
        // Calculate time until window expires
        const ttl = await redis.ttl(redisKey);
        const retryAfter = ttl > 0 ? String(ttl) : String(Math.ceil(windowMs / 1000));

        res.set('Retry-After', retryAfter);
        res.status(429).json({
          error: 'Rate limit exceeded',
          message: `Too many requests from ${phoneNumber}. Please try again later.`,
          retryAfter: parseInt(retryAfter, 10),
        });
        return;
      }

      // Request allowed - proceed
      next();
    } catch (error) {
      // Redis error - fail-closed (reject request)
      const correlationId = (req as any).correlationId || 'unknown';
      logger.error('Rate limiter error', {
        component: 'whatsapp-handler/rate-limiter',
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(503).json({
        error: 'Service temporarily unavailable',
        message: 'Rate limiting service is unavailable',
      });
    }
  };
}
