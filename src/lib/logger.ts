/**
 * Centralized Logger for WhatsApp Handler Service
 *
 * Uses @railrepay/winston-logger for structured logging with:
 * - Correlation IDs (ADR-002)
 * - Loki integration for log aggregation
 * - Console output for development
 * - Structured JSON format for production
 *
 * Per Technical Debt Register: TD-WHATSAPP-006
 */

import { createLogger, Logger } from '@railrepay/winston-logger';

let loggerInstance: Logger | null = null;

/**
 * Get or create the singleton logger instance
 *
 * @returns Winston logger instance
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    // Use environment variables directly to avoid circular dependency with config
    // and to handle test environments gracefully
    const serviceName = process.env.SERVICE_NAME || 'whatsapp-handler';
    const nodeEnv = process.env.NODE_ENV || 'development';

    loggerInstance = createLogger({
      serviceName,
      level: process.env.LOG_LEVEL || 'info',
      lokiEnabled: process.env.LOKI_ENABLED === 'true',
      lokiHost: process.env.LOKI_HOST,
      lokiBasicAuth: process.env.LOKI_BASIC_AUTH,
      environment: nodeEnv,
    });
  }

  return loggerInstance;
}

/**
 * Reset logger instance (for testing)
 */
export function resetLogger(): void {
  loggerInstance = null;
}
