/**
 * Configuration module with Zod validation
 * Per ADR-013: SERVICE_NAME environment variable mandatory
 * Per specification Section 8: Environment variables
 */

import { z } from 'zod';

/**
 * Environment configuration schema
 * All required variables must be present, optional have defaults
 *
 * IMPORTANT: Railway provides PostgreSQL/Redis as individual variables (PGHOST, PGPORT, etc.)
 * This schema supports BOTH formats:
 * - Individual vars: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 * - Connection string: DATABASE_URL
 */
const envSchema = z.object({
  // Service configuration (ADR-013)
  SERVICE_NAME: z.string().min(1),
  DATABASE_SCHEMA: z.string().default('whatsapp_handler'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
  LOG_LEVEL: z.string().default('info'),

  // PostgreSQL - supports both DATABASE_URL and individual PG* variables (Railway format)
  DATABASE_URL: z.string().optional(),
  PGHOST: z.string().optional(),
  PGPORT: z.string().regex(/^\d+$/).optional(),
  PGUSER: z.string().optional(),
  PGPASSWORD: z.string().optional(),
  PGDATABASE: z.string().optional(),
  PGSSLMODE: z.string().optional(),

  // Redis - supports both REDIS_URL and individual variables (Railway format)
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().regex(/^\d+$/).optional(),
  REDIS_PASSWORD: z.string().optional(),
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
 * Build PostgreSQL connection URL from individual variables or use DATABASE_URL
 */
function buildDatabaseUrl(env: z.infer<typeof envSchema>): string {
  // Prefer DATABASE_URL if provided
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }

  // Build from individual PG* variables (Railway format)
  if (env.PGHOST && env.PGUSER && env.PGPASSWORD && env.PGDATABASE) {
    const port = env.PGPORT || '5432';
    const sslParam = env.PGSSLMODE === 'require' ? '?sslmode=require' : '';
    return `postgresql://${env.PGUSER}:${env.PGPASSWORD}@${env.PGHOST}:${port}/${env.PGDATABASE}${sslParam}`;
  }

  throw new Error(
    'Database configuration missing. Provide either DATABASE_URL or PGHOST, PGUSER, PGPASSWORD, PGDATABASE'
  );
}

/**
 * Build Redis connection URL from individual variables or use REDIS_URL
 */
function buildRedisUrl(env: z.infer<typeof envSchema>): string {
  // Prefer REDIS_URL if provided
  if (env.REDIS_URL) {
    return env.REDIS_URL;
  }

  // Build from individual variables (Railway format)
  if (env.REDIS_HOST) {
    const port = env.REDIS_PORT || '6379';
    if (env.REDIS_PASSWORD) {
      return `redis://:${env.REDIS_PASSWORD}@${env.REDIS_HOST}:${port}`;
    }
    return `redis://${env.REDIS_HOST}:${port}`;
  }

  throw new Error('Redis configuration missing. Provide either REDIS_URL or REDIS_HOST');
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

  // Build connection URLs from available variables
  const databaseUrl = buildDatabaseUrl(env);
  const redisUrl = buildRedisUrl(env);

  return {
    serviceName: env.SERVICE_NAME,
    databaseSchema: env.DATABASE_SCHEMA,
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    database: {
      url: databaseUrl,
    },
    redis: {
      url: redisUrl,
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
