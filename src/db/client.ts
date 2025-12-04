/**
 * Database client with connection pooling
 * Per ADR-001: Schema-per-service isolation (whatsapp_handler schema)
 * Per SOPs: Use @railrepay/postgres-client for standardized database access
 *
 * REFACTORED: Now uses @railrepay/postgres-client (TD-WHATSAPP-016)
 */

import { PostgresClient, type Pool } from '@railrepay/postgres-client';
import type { QueryResult, QueryResultRow } from 'pg';
import { getLogger } from '../lib/logger.js';

const logger = getLogger();

// Re-export types for compatibility
export type { QueryResultRow } from 'pg';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
  max?: number;
  min?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export interface DatabaseClient {
  query<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>>;
  initialize(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  getPool(): Pool;
}

/**
 * Creates a database client with connection pooling using @railrepay/postgres-client
 *
 * @param config - Database configuration including schema name
 * @returns DatabaseClient instance
 *
 * @example
 * ```typescript
 * const client = createDatabaseClient({
 *   host: 'postgres.railway.internal',
 *   port: 5432,
 *   database: 'railway',
 *   user: 'postgres',
 *   password: process.env.PGPASSWORD,
 *   schema: 'whatsapp_handler',
 * });
 *
 * await client.initialize();
 * const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
 * ```
 */
export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  // Create PostgresClient from shared library
  const postgresClient = new PostgresClient({
    serviceName: 'whatsapp-handler',
    schemaName: config.schema,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: process.env.NODE_ENV === 'production',
    poolSize: config.max ?? 20,
    idleTimeout: config.idleTimeoutMillis ?? 10000,
    connectionTimeout: config.connectionTimeoutMillis ?? 5000,
    logger, // Pass our winston logger for structured logging
  });

  return {
    /**
     * Execute a SQL query with parameterized values
     *
     * @param text - SQL query string with $1, $2 placeholders
     * @param params - Array of parameter values
     * @returns Query result
     */
    async query<T extends QueryResultRow = any>(
      text: string,
      params?: any[]
    ): Promise<QueryResult<T>> {
      const rows = await postgresClient.query<T>(text, params);
      // Convert array result to QueryResult format for compatibility
      return {
        rows,
        rowCount: rows.length,
        command: '',
        oid: 0,
        fields: [],
      } as QueryResult<T>;
    },

    /**
     * Initialize the database connection
     * Must be called before using the client
     */
    async initialize(): Promise<void> {
      await postgresClient.connect();
    },

    /**
     * Gracefully disconnect and close all connections in the pool
     */
    async disconnect(): Promise<void> {
      await postgresClient.disconnect();
    },

    /**
     * Health check: Test database connectivity
     *
     * @returns true if database is reachable, false otherwise
     */
    async healthCheck(): Promise<boolean> {
      return postgresClient.healthCheck();
    },

    /**
     * Get the underlying pool instance (for advanced usage)
     */
    getPool(): Pool {
      return postgresClient.getPool();
    },
  };
}

/**
 * Create database client from environment variables
 *
 * @returns DatabaseClient instance configured from env
 */
export function createDatabaseClientFromEnv(): DatabaseClient {
  const config: DatabaseConfig = {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'railway',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    schema: process.env.DATABASE_SCHEMA || 'whatsapp_handler',
  };

  return createDatabaseClient(config);
}
