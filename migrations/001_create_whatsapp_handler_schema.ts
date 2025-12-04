/**
 * Migration: 001_create_whatsapp_handler_schema v2.0
 *
 * Purpose: Initial schema creation for whatsapp-handler service (SIMPLIFIED)
 *
 * Schema: whatsapp_handler
 * Tables: users, user_preferences, outbox_events
 *
 * ADR Compliance:
 * - ADR-001: Schema-per-service isolation (whatsapp_handler schema)
 * - ADR-003: node-pg-migrate for migrations
 * - ADR-014: TDD workflow (tests written first)
 *
 * Related RFC: docs/RFC-whatsapp-handler-schema-v2.md
 * Related Specification: /specifications/whatsapp-handler-specification.md
 *
 * User Stories:
 * - RAILREPAY-001: First-time user registration via WhatsApp
 * - RAILREPAY-002: Returning user authentication
 * - RAILREPAY-100: Journey selection and validation
 * - RAILREPAY-600: WhatsApp webhook processing and security
 *
 * DESIGN RATIONALE (v2.0 Simplification):
 * - OTP verification moved to Twilio Verify API (external service)
 * - Display name removed (not needed for phone-based auth)
 * - Terms acceptance removed (handled by claim-dispatcher service)
 * - Activity tracking removed (24hr Redis TTL for FSM state)
 * - user_preferences simplified to key-value store for flexibility
 */

import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

/**
 * UP Migration: Create schema, tables, and indexes
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  // Step 1: Create schema (idempotent)
  pgm.createSchema('whatsapp_handler', { ifNotExists: true });

  // Step 2: Create users table (SIMPLIFIED v2.0)
  // Rationale: Minimal user identity for phone-based authentication
  pgm.createTable(
    { schema: 'whatsapp_handler', name: 'users' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
        notNull: true,
        comment: 'Primary key using PostgreSQL 13+ gen_random_uuid()',
      },
      phone_number: {
        type: 'varchar(20)',
        notNull: true,
        comment: 'E.164 format phone number (e.g., +447700900123)',
      },
      verified_at: {
        type: 'timestamptz',
        notNull: false,
        comment: 'Timestamp when Twilio Verify verification completed',
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
    }
  );

  // Step 3: Add unique constraint on phone_number (named constraint)
  pgm.addConstraint(
    { schema: 'whatsapp_handler', name: 'users' },
    'users_phone_number_unique',
    {
      unique: ['phone_number'],
    }
  );

  // Step 4: Create indexes on users table
  pgm.createIndex(
    { schema: 'whatsapp_handler', name: 'users' },
    'phone_number',
    {
      name: 'idx_users_phone',
      method: 'btree',
    }
  );

  pgm.createIndex(
    { schema: 'whatsapp_handler', name: 'users' },
    'verified_at',
    {
      name: 'idx_users_verified',
      method: 'btree',
      where: 'verified_at IS NOT NULL',
    }
  );

  // Step 5: Create user_preferences table (KEY-VALUE STORE)
  // Rationale: Flexible schema allows adding preferences without ALTER TABLE
  pgm.createTable(
    { schema: 'whatsapp_handler', name: 'user_preferences' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
        notNull: true,
      },
      user_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'whatsapp_handler', name: 'users' },
        onDelete: 'CASCADE',
        comment: 'FK to users table with cascade delete (GDPR compliance)',
      },
      preference_key: {
        type: 'varchar(100)',
        notNull: true,
        comment: 'Preference name (e.g., language, timezone, notification_enabled)',
      },
      preference_value: {
        type: 'text',
        notNull: false,
        comment: 'Preference value (string, JSON, or null)',
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
    }
  );

  // Step 6: Add unique constraint on user_id + preference_key
  pgm.addConstraint(
    { schema: 'whatsapp_handler', name: 'user_preferences' },
    'user_preferences_user_key_unique',
    {
      unique: ['user_id', 'preference_key'],
    }
  );

  // Step 7: Create index on user_preferences.user_id
  pgm.createIndex(
    { schema: 'whatsapp_handler', name: 'user_preferences' },
    'user_id',
    {
      name: 'idx_user_preferences_user',
      method: 'btree',
    }
  );

  // Step 8: Create outbox_events table (SIMPLIFIED v2.0)
  // Rationale: Removed event_version, metadata, correlation_id - not needed at MVP scale
  pgm.createTable(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
        notNull: true,
      },
      aggregate_id: {
        type: 'uuid',
        notNull: true,
        comment: 'ID of the aggregate root (e.g., user_id, journey_id)',
      },
      aggregate_type: {
        type: 'varchar(100)',
        notNull: true,
        comment: 'Type of aggregate (user, journey, claim)',
      },
      event_type: {
        type: 'varchar(100)',
        notNull: true,
        comment: 'Event type (user.registered, user.verified, etc.)',
      },
      payload: {
        type: 'jsonb',
        notNull: true,
        comment: 'Event payload (flexible JSON structure)',
      },
      published_at: {
        type: 'timestamptz',
        notNull: false,
        comment: 'Set by outbox-relay after successful publish to Pub/Sub',
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
    }
  );

  // Step 9: Add CHECK constraint on aggregate_type
  pgm.addConstraint(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    'outbox_events_aggregate_check',
    {
      check: "aggregate_type IN ('user', 'journey', 'claim')",
    }
  );

  // Step 10: Create indexes on outbox_events table
  pgm.createIndex(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    'created_at',
    {
      name: 'idx_outbox_events_published',
      method: 'btree',
      where: 'published_at IS NULL',
    }
  );

  pgm.createIndex(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    'created_at',
    {
      name: 'idx_outbox_events_created',
      method: 'btree',
    }
  );

  // Step 11: Add table comments
  pgm.sql(`
    COMMENT ON TABLE whatsapp_handler.users IS 'User authentication via phone number (Twilio Verify)';
    COMMENT ON TABLE whatsapp_handler.user_preferences IS 'User settings (key-value store for flexibility)';
    COMMENT ON TABLE whatsapp_handler.outbox_events IS 'Transactional outbox for event publishing to Pub/Sub';
  `);
}

/**
 * DOWN Migration: Rollback schema (drop everything)
 *
 * Safety: This migration is safe to rollback because:
 * 1. This is a new service with no existing data
 * 2. No dependent services exist yet (first deployment)
 * 3. CASCADE drops will handle foreign keys
 */
export async function down(pgm: MigrationBuilder): Promise<void> {
  // Drop tables in reverse order (cascade handles FKs)
  pgm.dropTable(
    { schema: 'whatsapp_handler', name: 'outbox_events' },
    { ifExists: true, cascade: true }
  );

  pgm.dropTable(
    { schema: 'whatsapp_handler', name: 'user_preferences' },
    { ifExists: true, cascade: true }
  );

  pgm.dropTable(
    { schema: 'whatsapp_handler', name: 'users' },
    { ifExists: true, cascade: true }
  );

  // Drop schema
  pgm.dropSchema('whatsapp_handler', { ifExists: true, cascade: true });
}
