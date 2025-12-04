/**
 * Integration tests for whatsapp_handler schema migrations
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
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const { Pool } = pg;
// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
describe('whatsapp_handler schema migrations', () => {
    let container;
    let pool;
    let migrationPath;
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
        // Enable uuid-ossp extension (required for migrations)
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
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
        it('should create users table with correct columns', async () => {
            const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'whatsapp_handler'
        AND table_name = 'users'
        ORDER BY ordinal_position;
      `);
            const columns = result.rows.map((r) => r.column_name);
            expect(columns).toEqual([
                'id',
                'phone_number',
                'display_name',
                'verified_at',
                'registered_at',
                'last_active_at',
                'otp_secret',
                'otp_verified_at',
                'terms_accepted_at',
                'terms_version',
                'blocked_at',
                'block_reason',
                'created_at',
                'updated_at',
            ]);
            // Verify NOT NULL constraints
            const phoneNumberColumn = result.rows.find((r) => r.column_name === 'phone_number');
            expect(phoneNumberColumn?.is_nullable).toBe('NO');
            // Verify default values
            const idColumn = result.rows.find((r) => r.column_name === 'id');
            expect(idColumn?.column_default).toContain('uuid_generate_v4');
        });
        it('should create user_preferences table with correct columns', async () => {
            const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'whatsapp_handler'
        AND table_name = 'user_preferences'
        ORDER BY ordinal_position;
      `);
            const columns = result.rows.map((r) => r.column_name);
            expect(columns).toEqual([
                'id',
                'user_id',
                'notification_enabled',
                'language',
                'timezone',
                'delay_threshold_minutes',
                'auto_claim_enabled',
                'created_at',
                'updated_at',
            ]);
            // Verify defaults
            const notificationColumn = result.rows.find((r) => r.column_name === 'notification_enabled');
            expect(notificationColumn?.column_default).toBe('true');
            const languageColumn = result.rows.find((r) => r.column_name === 'language');
            expect(languageColumn?.column_default).toContain('en-GB');
        });
        it('should create outbox_events table with correct columns', async () => {
            const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'whatsapp_handler'
        AND table_name = 'outbox_events'
        ORDER BY ordinal_position;
      `);
            const columns = result.rows.map((r) => r.column_name);
            expect(columns).toEqual([
                'id',
                'aggregate_id',
                'aggregate_type',
                'event_type',
                'event_version',
                'payload',
                'metadata',
                'correlation_id',
                'created_at',
                'published_at',
            ]);
            // Verify JSONB columns
            const payloadColumn = result.rows.find((r) => r.column_name === 'payload');
            expect(payloadColumn?.data_type).toBe('jsonb');
        });
        it('should create all required indexes', async () => {
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
            expect(indexNames).toContain('idx_users_last_active');
            // User preferences index
            expect(indexNames).toContain('idx_user_prefs_user');
            // Outbox events indexes
            expect(indexNames).toContain('idx_outbox_unpublished');
            expect(indexNames).toContain('idx_outbox_aggregate');
            expect(indexNames).toContain('idx_outbox_correlation');
            // Verify partial index (verified users only)
            const verifiedIndex = result.rows.find((r) => r.indexname === 'idx_users_verified');
            expect(verifiedIndex?.indexdef).toContain('WHERE');
            expect(verifiedIndex?.indexdef).toContain('verified_at IS NOT NULL');
        });
        it('should enforce unique constraint on phone_number', async () => {
            // Insert first user
            await pool.query(`
        INSERT INTO whatsapp_handler.users (phone_number, registered_at)
        VALUES ('+447700900123', NOW());
      `);
            // Attempt to insert duplicate phone number
            await expect(pool.query(`
          INSERT INTO whatsapp_handler.users (phone_number, registered_at)
          VALUES ('+447700900123', NOW());
        `)).rejects.toThrow(/duplicate key value violates unique constraint/);
        });
        it('should enforce unique constraint on user_preferences.user_id', async () => {
            // Get user ID from previous test
            const userResult = await pool.query(`
        SELECT id FROM whatsapp_handler.users LIMIT 1;
      `);
            const userId = userResult.rows[0].id;
            // Insert first preference
            await pool.query(`
        INSERT INTO whatsapp_handler.user_preferences (user_id)
        VALUES ($1);
      `, [userId]);
            // Attempt to insert duplicate preference for same user
            await expect(pool.query(`
          INSERT INTO whatsapp_handler.user_preferences (user_id)
          VALUES ($1);
        `, [userId])).rejects.toThrow(/duplicate key value violates unique constraint/);
        });
        it('should cascade delete user_preferences when user is deleted', async () => {
            // Insert new user
            const insertResult = await pool.query(`
        INSERT INTO whatsapp_handler.users (phone_number, registered_at)
        VALUES ('+447700900999', NOW())
        RETURNING id;
      `);
            const userId = insertResult.rows[0].id;
            // Insert preferences
            await pool.query(`
        INSERT INTO whatsapp_handler.user_preferences (user_id)
        VALUES ($1);
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
        it('should use partial index for verified users query', async () => {
            // Insert verified user
            await pool.query(`
        INSERT INTO whatsapp_handler.users (phone_number, verified_at, registered_at)
        VALUES ('+447700900888', NOW(), NOW());
      `);
            // Query with EXPLAIN to verify index usage
            const explainResult = await pool.query(`
        EXPLAIN (FORMAT JSON)
        SELECT id, phone_number
        FROM whatsapp_handler.users
        WHERE verified_at IS NOT NULL;
      `);
            const plan = JSON.stringify(explainResult.rows[0]);
            expect(plan).toContain('idx_users_verified');
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
async function runMigrationUp(pool) {
    const migrationFile = resolve(__dirname, '../../migrations/001_create_whatsapp_handler_schema.ts');
    try {
        // Dynamic import of migration file
        const migration = await import(migrationFile);
        // Execute UP migration
        await migration.up({
            db: pool,
            query: (sql, values) => pool.query(sql, values),
            createTable: async (tableName, columns) => {
                // Simplified createTable implementation
                // Real implementation would use node-pg-migrate API
                console.log(`Creating table: ${tableName}`);
            },
        });
    }
    catch (error) {
        console.error('Migration UP failed:', error);
        throw error;
    }
}
/**
 * Helper: Run migration DOWN
 * Simulates node-pg-migrate down command
 */
async function runMigrationDown(pool) {
    const migrationFile = resolve(__dirname, '../../migrations/001_create_whatsapp_handler_schema.ts');
    try {
        // Dynamic import of migration file
        const migration = await import(migrationFile);
        // Execute DOWN migration
        await migration.down({
            db: pool,
            query: (sql, values) => pool.query(sql, values),
        });
    }
    catch (error) {
        console.error('Migration DOWN failed:', error);
        throw error;
    }
}
//# sourceMappingURL=migrations.test.js.map