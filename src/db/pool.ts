/**
 * Database Pool Singleton
 *
 * Provides global access to the database pool for services that need
 * direct database access without constructor injection.
 *
 * USAGE:
 * - Call setPool() once during application startup (index.ts)
 * - Call getPool() from services that need database access
 *
 * Per ADR-001: Services should use schema-per-service isolation
 * Note: This pattern is used for cross-schema queries (e.g., timetable_loader.stations)
 */

import type { Pool } from 'pg';

let poolInstance: Pool | null = null;

/**
 * Set the database pool instance (called once at startup)
 *
 * @param pool - PostgreSQL pool instance
 */
export function setPool(pool: Pool): void {
  poolInstance = pool;
}

/**
 * Get the database pool instance
 *
 * @returns PostgreSQL pool instance
 * @throws Error if pool not initialized (setPool not called)
 */
export function getPool(): Pool {
  if (!poolInstance) {
    throw new Error(
      'Database pool not initialized. Call setPool() during application startup.'
    );
  }
  return poolInstance;
}

/**
 * Reset pool instance (for testing)
 */
export function resetPool(): void {
  poolInstance = null;
}
