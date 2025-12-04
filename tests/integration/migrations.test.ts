/**
 * Integration tests for whatsapp_handler schema migrations (v2.0)
 *
 * TDD Workflow (ADR-014):
 * 1. These tests MUST FAIL initially (no migration exists yet)
 * 2. Implement migration to make tests pass
 * 3. Verify all tests GREEN
 *
 * Testing Strategy:
 * - Use Testcontainers for real PostgreSQL instance
 * - Test schema creation, table structure, indexes, constraints
 * - Test rollback capability
 *
 * v2.0 Changes:
 * - users table simplified (5 columns only)
 * - user_preferences changed to key-value store
 * - outbox_events simplified (no correlation_id, metadata, event_version)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const { Pool } = pg;

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('whatsapp_handler schema migrations v2.0', () => {
  let container: PostgreSqlContainer;
  let pool: pg.Pool;
  let migrationPath: string;

  beforeAll(async () => {
    // Start PostgreSQL container (Testcontainers)
    console.log('Starting PostgreSQL container...');
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('test')
      .withUsername('test')
      .withPassword('test')
      .start();

    // Create connection pool
    pool = new Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });

    // Resolve migration file path
    migrationPath = resolve(__dirname, '../../migrations');
    console.log(`Migration path: ${migrationPath}`);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  describe('UP migration: create schema and tables', () => {
    it('should create whatsapp_handler schema', async () => {
      // Run migration manually (simulate node-pg-migrate UP)
      await runMigrationUp(pool);

      // Verify schema exists
      const result = await pool.query(`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name = 'whatsapp_handler';
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].schema_name).toBe('whatsapp_handler');
    });

    it('should create users table with correct columns (v2.0 simplified)', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'whatsapp_handler'
        AND table_name = 'users'
        ORDER BY ordinal_position;
      `);

      const columns = result.rows.map((r) => r.column_name);

      // v2.0 schema: ONLY 5 columns (no otp_secret, display_name, etc.)
      expect(columns).toEqual([
        'id',
        'phone_number',
        'verified_at',
        'created_at',
        'updated_at',
      ]);

      // Verify NOT NULL constraints
      const phoneNumberColumn = result.rows.find(
        (r) => r.column_name === 'phone_number'
      );
      expect(phoneNumberColumn?.is_nullable).toBe('NO');

      // Verify default values
      const idColumn = result.rows.find((r) => r.column_name === 'id');
      expect(idColumn?.column_default).toContain('gen_random_uuid');
    });

    it('should create user_preferences table with key-value schema (v2.0)', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'whatsapp_handler'
        AND table_name = 'user_preferences'
        ORDER BY ordinal_position;
      `);

      const columns = result.rows.map((r) => r.column_name);

      // v2.0 schema: Key-value store (preference_key, preference_value)
      expect(columns).toEqual([
        'id',
        'user_id',
        'preference_key',
        'preference_value',
        'created_at',
        'updated_at',
      ]);

      // Verify key-value columns
      const keyColumn = result.rows.find(
        (r) => r.column_name === 'preference_key'
      );
      expect(keyColumn?.data_type).toBe('character varying');
      expect(keyColumn?.is_nullable).toBe('NO');

      const valueColumn = result.rows.find(
        (r) => r.column_name === 'preference_value'
      );
      expect(valueColumn?.data_type).toBe('text');
      expect(valueColumn?.is_nullable).toBe('YES'); // Nullable for flexibility
    });

    it('should create outbox_events table with simplified schema (v2.0)', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'whatsapp_handler'
        AND table_name = 'outbox_events'
        ORDER BY ordinal_position;
      `);

      const columns = result.rows.map((r) => r.column_name);

      // v2.0 schema: NO correlation_id, metadata, event_version
      expect(columns).toEqual([
        'id',
        'aggregate_id',
        'aggregate_type',
        'event_type',
        'payload',
        'published_at',
        'created_at',
      ]);

      // Verify JSONB columns
      const payloadColumn = result.rows.find((r) => r.column_name === 'payload');
      expect(payloadColumn?.data_type).toBe('jsonb');
    });

    it('should create all required indexes (v2.0)', async () => {
      const result = await pool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'whatsapp_handler'
        ORDER BY indexname;
      `);

      const indexNames = result.rows.map((r) => r.indexname);

      // Users table indexes
      expect(indexNames).toContain('idx_users_phone');
      expect(indexNames).toContain('idx_users_verified');

      // User preferences index
      expect(indexNames).toContain('idx_user_preferences_user');

      // Outbox events indexes
      expect(indexNames).toContain('idx_outbox_events_published');
      expect(indexNames).toContain('idx_outbox_events_created');

      // Verify partial index (verified users only)
      const verifiedIndex = result.rows.find(
        (r) => r.indexname === 'idx_users_verified'
      );
      expect(verifiedIndex?.indexdef).toContain('WHERE');
      expect(verifiedIndex?.indexdef).toContain('verified_at IS NOT NULL');
    });

    it('should enforce unique constraint on phone_number', async () => {
      // Insert first user
      await pool.query(`
        INSERT INTO whatsapp_handler.users (phone_number, created_at, updated_at)
        VALUES ('+447700900123', NOW(), NOW());
      `);

      // Attempt to insert duplicate phone number
      await expect(
        pool.query(`
          INSERT INTO whatsapp_handler.users (phone_number, created_at, updated_at)
          VALUES ('+447700900123', NOW(), NOW());
        `)
      ).rejects.toThrow(/duplicate key value violates unique constraint/);
    });

    it('should enforce unique constraint on user_id + preference_key', async () => {
      // Get user ID from previous test
      const userResult = await pool.query(`
        SELECT id FROM whatsapp_handler.users LIMIT 1;
      `);
      const userId = userResult.rows[0].id;

      // Insert first preference
      await pool.query(`
        INSERT INTO whatsapp_handler.user_preferences (user_id, preference_key, preference_value, created_at, updated_at)
        VALUES ($1, 'language', 'en-GB', NOW(), NOW());
      `, [userId]);

      // Attempt to insert duplicate preference_key for same user
      await expect(
        pool.query(`
          INSERT INTO whatsapp_handler.user_preferences (user_id, preference_key, preference_value, created_at, updated_at)
          VALUES ($1, 'language', 'en-US', NOW(), NOW());
        `, [userId])
      ).rejects.toThrow(/duplicate key value violates unique constraint/);
    });

    it('should cascade delete user_preferences when user is deleted', async () => {
      // Insert new user
      const insertResult = await pool.query(`
        INSERT INTO whatsapp_handler.users (phone_number, created_at, updated_at)
        VALUES ('+447700900999', NOW(), NOW())
        RETURNING id;
      `);
      const userId = insertResult.rows[0].id;

      // Insert preferences
      await pool.query(`
        INSERT INTO whatsapp_handler.user_preferences (user_id, preference_key, preference_value, created_at, updated_at)
        VALUES ($1, 'timezone', 'Europe/London', NOW(), NOW());
      `, [userId]);

      // Verify preference exists
      const beforeDelete = await pool.query(`
        SELECT COUNT(*) as count
        FROM whatsapp_handler.user_preferences
        WHERE user_id = $1;
      `, [userId]);
      expect(Number(beforeDelete.rows[0].count)).toBe(1);

      // Delete user
      await pool.query(`
        DELETE FROM whatsapp_handler.users WHERE id = $1;
      `, [userId]);

      // Verify preference was cascade deleted
      const afterDelete = await pool.query(`
        SELECT COUNT(*) as count
        FROM whatsapp_handler.user_preferences
        WHERE user_id = $1;
      `, [userId]);
      expect(Number(afterDelete.rows[0].count)).toBe(0);
    });

    it('should enforce CHECK constraint on aggregate_type', async () => {
      // Valid aggregate_type: 'user'
      await pool.query(`
        INSERT INTO whatsapp_handler.outbox_events (aggregate_id, aggregate_type, event_type, payload, created_at)
        VALUES (gen_random_uuid(), 'user', 'user.registered', '{"test": true}'::jsonb, NOW());
      `);

      // Invalid aggregate_type: 'invalid'
      await expect(
        pool.query(`
          INSERT INTO whatsapp_handler.outbox_events (aggregate_id, aggregate_type, event_type, payload, created_at)
          VALUES (gen_random_uuid(), 'invalid', 'test.event', '{"test": true}'::jsonb, NOW());
        `)
      ).rejects.toThrow(/violates check constraint/);
    });

    it('should use partial index for unpublished events query', async () => {
      // Insert unpublished event
      await pool.query(`
        INSERT INTO whatsapp_handler.outbox_events (aggregate_id, aggregate_type, event_type, payload, published_at, created_at)
        VALUES (gen_random_uuid(), 'journey', 'journey.selected', '{"test": true}'::jsonb, NULL, NOW());
      `);

      // Query with EXPLAIN to verify index usage
      const explainResult = await pool.query(`
        EXPLAIN (FORMAT JSON)
        SELECT id, event_type
        FROM whatsapp_handler.outbox_events
        WHERE published_at IS NULL
        ORDER BY created_at ASC;
      `);

      const plan = JSON.stringify(explainResult.rows[0]);
      expect(plan).toContain('idx_outbox_events_published');
    });

    it('should allow multiple preferences per user (key-value store)', async () => {
      // Get user ID
      const userResult = await pool.query(`
        SELECT id FROM whatsapp_handler.users LIMIT 1;
      `);
      const userId = userResult.rows[0].id;

      // Insert multiple preferences
      await pool.query(`
        INSERT INTO whatsapp_handler.user_preferences (user_id, preference_key, preference_value, created_at, updated_at)
        VALUES
          ($1, 'notification_enabled', 'true', NOW(), NOW()),
          ($1, 'delay_threshold_minutes', '15', NOW(), NOW())
        ON CONFLICT (user_id, preference_key) DO NOTHING;
      `, [userId]);

      // Verify multiple preferences exist
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM whatsapp_handler.user_preferences
        WHERE user_id = $1;
      `, [userId]);

      // Should have at least 3 preferences (language + notification_enabled + delay_threshold_minutes)
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(3);
    });
  });

  describe('DOWN migration: rollback schema', () => {
    it('should drop all tables and schema', async () => {
      // Run migration rollback
      await runMigrationDown(pool);

      // Verify schema is dropped
      const schemaResult = await pool.query(`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name = 'whatsapp_handler';
      `);
      expect(schemaResult.rows).toHaveLength(0);

      // Verify tables are dropped
      const tablesResult = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'whatsapp_handler';
      `);
      expect(tablesResult.rows).toHaveLength(0);
    });
  });
});

/**
 * Helper: Run migration UP
 * Simulates node-pg-migrate up command
 */
async function runMigrationUp(pool: pg.Pool): Promise<void> {
  const migrationFile = resolve(
    __dirname,
    '../../migrations/001_create_whatsapp_handler_schema.ts'
  );

  try {
    // Dynamic import of migration file
    const migration = await import(migrationFile);

    // Execute UP migration
    await migration.up({
      db: pool,
      query: (sql: string, values?: any[]) => pool.query(sql, values),
      createTable: async (tableName: string, columns: any) => {
        // Simplified createTable implementation
        // Real implementation would use node-pg-migrate API
        console.log(`Creating table: ${tableName}`);
      },
    } as any);
  } catch (error) {
    console.error('Migration UP failed:', error);
    throw error;
  }
}

/**
 * Helper: Run migration DOWN
 * Simulates node-pg-migrate down command
 */
async function runMigrationDown(pool: pg.Pool): Promise<void> {
  const migrationFile = resolve(
    __dirname,
    '../../migrations/001_create_whatsapp_handler_schema.ts'
  );

  try {
    // Dynamic import of migration file
    const migration = await import(migrationFile);

    // Execute DOWN migration
    await migration.down({
      db: pool,
      query: (sql: string, values?: any[]) => pool.query(sql, values),
    } as any);
  } catch (error) {
    console.error('Migration DOWN failed:', error);
    throw error;
  }
}
