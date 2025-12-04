/**
 * Configuration module with Zod validation
 * Per ADR-013: SERVICE_NAME environment variable mandatory
 * Per specification Section 8: Environment variables
 */

import { z } from 'zod';

/**
 * Environment configuration schema
 * All required variables must be present, optional have defaults
 */
const envSchema = z.object({
  // Service configuration (ADR-013)
  SERVICE_NAME: z.string().min(1),
  DATABASE_SCHEMA: z.string().default('whatsapp_handler'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
  LOG_LEVEL: z.string().default('info'),

  // PostgreSQL
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),
  REDIS_CACHE_TTL_SECONDS: z.string().regex(/^\d+$/).transform(Number).default('86400'),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_WHATSAPP_NUMBER: z.string().regex(/^whatsapp:\+[1-9]\d{1,14}$/),

  // Observability (ADR-002, ADR-006, ADR-007)
  LOKI_HOST: z.string().url().optional(),
  LOKI_BASIC_AUTH: z.string().optional(),
  LOKI_ENABLED: z.string().transform(val => val === 'true').default('false'),
  LOKI_LEVEL: z.string().default('info'),
  ALLOY_PUSH_URL: z.string().url().optional(),
  METRICS_PORT: z.string().regex(/^\d+$/).transform(Number).default('9090'),
  METRICS_PUSH_INTERVAL: z.string().regex(/^\d+$/).transform(Number).default('15000'),

  // External services
  TIMETABLE_LOADER_URL: z.string().url().optional(),
});

/**
 * Configuration interface
 */
export interface Config {
  serviceName: string;
  databaseSchema: string;
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  database: {
    url: string;
  };
  redis: {
    url: string;
    cacheTtlSeconds: number;
  };
  twilio: {
    accountSid: string;
    authToken: string;
    whatsappNumber: string;
  };
  observability: {
    loki: {
      host?: string;
      basicAuth?: string;
      enabled: boolean;
      level: string;
    };
    alloyPushUrl?: string;
    metricsPort: number;
    metricsPushInterval: number;
  };
  externalServices: {
    timetableLoaderUrl?: string;
  };
}

/**
 * Load and validate configuration from environment variables
 * Throws error if validation fails (fail fast)
 *
 * @returns Validated configuration object
 * @throws ZodError if environment variables are invalid
 */
export function loadConfig(): Config {
  const env = envSchema.parse(process.env);

  return {
    serviceName: env.SERVICE_NAME,
    databaseSchema: env.DATABASE_SCHEMA,
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    database: {
      url: env.DATABASE_URL,
    },
    redis: {
      url: env.REDIS_URL,
      cacheTtlSeconds: env.REDIS_CACHE_TTL_SECONDS,
    },
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      whatsappNumber: env.TWILIO_WHATSAPP_NUMBER,
    },
    observability: {
      loki: {
        host: env.LOKI_HOST,
        basicAuth: env.LOKI_BASIC_AUTH,
        enabled: env.LOKI_ENABLED,
        level: env.LOKI_LEVEL,
      },
      alloyPushUrl: env.ALLOY_PUSH_URL,
      metricsPort: env.METRICS_PORT,
      metricsPushInterval: env.METRICS_PUSH_INTERVAL,
    },
    externalServices: {
      timetableLoaderUrl: env.TIMETABLE_LOADER_URL,
    },
  };
}

/**
 * Singleton configuration instance
 * Loaded once at startup
 */
let configInstance: Config | null = null;

/**
 * Get configuration instance
 * Lazy-loads on first access
 *
 * @returns Configuration object
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset configuration (for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
