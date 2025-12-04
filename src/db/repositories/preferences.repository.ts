/**
 * PreferencesRepository v2.0 - Key-Value Preference Storage
 *
 * SPEC: Notion › Architecture › Data Layer › whatsapp_handler.user_preferences
 * RFC: RFC-whatsapp-handler-schema-v2.md § 2.2 User Preferences
 * Per ADR-014: Implementation written AFTER tests
 * Per ADR-001: Schema-per-service isolation (whatsapp_handler schema)
 *
 * DESIGN:
 * - Key-value store for user preferences (no ALTER TABLE migrations needed)
 * - UPSERT support via ON CONFLICT (PostgreSQL 9.5+)
 * - Foreign key constraint to users.id (CASCADE DELETE)
 */

import type { Pool } from 'pg';
import type { UserPreference } from '../types.v2';

export class PreferencesRepository {
  constructor(private pool: Pool) {}

  /**
   * Get all preferences for a user
   *
   * @param userId - User UUID
   * @returns Array of preferences (empty if none exist)
   */
  async getUserPreferences(userId: string): Promise<UserPreference[]> {
    const result = await this.pool.query<UserPreference>(
      `SELECT id, user_id, preference_key, preference_value, created_at, updated_at
       FROM whatsapp_handler.user_preferences
       WHERE user_id = $1
       ORDER BY preference_key ASC`,
      [userId]
    );

    return result.rows;
  }

  /**
   * Get a specific preference by key
   *
   * @param userId - User UUID
   * @param key - Preference key (e.g., 'language', 'notification_enabled')
   * @returns Preference record or null if not found
   */
  async getPreference(userId: string, key: string): Promise<UserPreference | null> {
    const result = await this.pool.query<UserPreference>(
      `SELECT id, user_id, preference_key, preference_value, created_at, updated_at
       FROM whatsapp_handler.user_preferences
       WHERE user_id = $1 AND preference_key = $2`,
      [userId, key]
    );

    return result.rows[0] ?? null;
  }

  /**
   * Set a preference (INSERT or UPDATE via UPSERT)
   *
   * Per PostgreSQL docs: ON CONFLICT ... DO UPDATE (UPSERT pattern)
   * Unique constraint: (user_id, preference_key)
   *
   * @param userId - User UUID
   * @param key - Preference key
   * @param value - Preference value (TEXT)
   * @returns Created or updated preference record
   * @throws Error if foreign key constraint fails (user_id does not exist)
   */
  async setPreference(userId: string, key: string, value: string): Promise<UserPreference> {
    const result = await this.pool.query<UserPreference>(
      `INSERT INTO whatsapp_handler.user_preferences (user_id, preference_key, preference_value)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, preference_key)
       DO UPDATE SET preference_value = EXCLUDED.preference_value, updated_at = NOW()
       RETURNING id, user_id, preference_key, preference_value, created_at, updated_at`,
      [userId, key, value]
    );

    return result.rows[0];
  }

  /**
   * Delete a specific preference by key
   *
   * @param userId - User UUID
   * @param key - Preference key
   * @returns true if deleted, false if not found
   */
  async deletePreference(userId: string, key: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM whatsapp_handler.user_preferences
       WHERE user_id = $1 AND preference_key = $2`,
      [userId, key]
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete all preferences for a user
   *
   * DESIGN: This is automatically handled by CASCADE DELETE when user is deleted,
   * but provided for explicit cleanup operations.
   *
   * @param userId - User UUID
   * @returns Number of preferences deleted
   */
  async deleteAllUserPreferences(userId: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM whatsapp_handler.user_preferences
       WHERE user_id = $1`,
      [userId]
    );

    return result.rowCount ?? 0;
  }
}
