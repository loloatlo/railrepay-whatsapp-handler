/**
 * UserRepository v2.0 - CRUD operations for users table (SIMPLIFIED SCHEMA)
 *
 * Per RFC-whatsapp-handler-schema-v2.md:
 * - ONLY 5 columns in users table
 * - phone_number is unique identifier (E.164 format)
 * - verified_at set by Twilio Verify callback (external service)
 * - NO otp_secret, display_name, terms, blocked_at (moved to other services or removed)
 *
 * Schema: whatsapp_handler.users
 * Owner: whatsapp-handler service
 *
 * User Story References:
 * - RAILREPAY-001: First-time user registration
 * - RAILREPAY-002: Returning user authentication
 *
 * ADR Compliance:
 * - ADR-001: Schema-per-service isolation
 * - ADR-014: TDD (tests written first)
 */

import type { Pool } from 'pg';
import type { User, CreateUserDTO, UpdateUserDTO } from '../types.js';
import { z } from 'zod';

/**
 * E.164 phone number validation schema
 * Format: +[country code][number] (e.g., +447700900123)
 */
const phoneNumberSchema = z.string().regex(
  /^\+[1-9]\d{1,14}$/,
  'Invalid phone number format - must be E.164 (+447700900123)'
);

/**
 * Custom error for duplicate phone number
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Repository for users table (v2.0 simplified schema)
 *
 * @example
 * ```typescript
 * const userRepo = new UserRepository(pool);
 *
 * // Create new user
 * const user = await userRepo.create({
 *   phone_number: '+447700900123',
 * });
 *
 * // Find by phone
 * const existing = await userRepo.findByPhone('+447700900123');
 *
 * // Mark as verified (Twilio Verify callback)
 * await userRepo.update(user.id, {
 *   verified_at: new Date(),
 * });
 * ```
 */
export class UserRepository {
  constructor(private pool: Pool) {}

  /**
   * Create a new user (v2.0)
   *
   * @param data - User creation data (phone_number only)
   * @returns Created user record
   * @throws ConflictError if phone number already exists
   * @throws ValidationError if phone number format is invalid
   */
  async create(data: CreateUserDTO): Promise<User> {
    // Validate phone number format (E.164)
    const validation = phoneNumberSchema.safeParse(data.phone_number);
    if (!validation.success) {
      throw new Error(validation.error.errors[0].message);
    }

    const query = `
      INSERT INTO users (phone_number)
      VALUES ($1)
      RETURNING *
    `;

    try {
      const result = await this.pool.query<User>(query, [data.phone_number]);
      return result.rows[0];
    } catch (error: any) {
      // PostgreSQL unique constraint violation code
      if (error.code === '23505') {
        throw new ConflictError('Phone number already registered');
      }
      throw error;
    }
  }

  /**
   * Find user by phone number (v2.0)
   * Per specification: Phone number is unique identifier (E.164 format)
   *
   * @param phoneNumber - E.164 format phone number (+447700900123)
   * @returns User if found, null otherwise
   */
  async findByPhone(phoneNumber: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE phone_number = $1';
    const result = await this.pool.query<User>(query, [phoneNumber]);
    return result.rows[0] || null;
  }

  /**
   * Find user by ID (v2.0)
   *
   * @param id - User UUID
   * @returns User if found, null otherwise
   */
  async findById(id: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE id = $1';
    const result = await this.pool.query<User>(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Update user fields (v2.0)
   * Only verified_at can be updated (Twilio Verify callback)
   *
   * @param id - User UUID
   * @param data - Fields to update (verified_at only)
   * @returns Updated user if found, null otherwise
   */
  async update(id: string, data: UpdateUserDTO): Promise<User | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Only verified_at is updateable in v2.0 schema
    if (data.verified_at !== undefined) {
      fields.push(`verified_at = $${paramIndex++}`);
      values.push(data.verified_at);
    }

    // Always update updated_at timestamp
    fields.push(`updated_at = NOW()`);

    if (fields.length === 1) {
      // No fields to update (only updated_at would be changed)
      return this.findById(id);
    }

    const query = `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    values.push(id);

    const result = await this.pool.query<User>(query, values);
    return result.rows[0] || null;
  }

  /**
   * Hard delete a user (GDPR compliance only)
   * Per RFC § 2.1: v2.0 uses hard delete, not soft delete
   *
   * WARNING: This permanently deletes the user and cascades to user_preferences
   *
   * @param id - User UUID
   * @returns true if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM users WHERE id = $1';
    const result = await this.pool.query(query, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Find all verified users (for analytics)
   * Per RFC: Uses partial index idx_users_verified
   *
   * @returns Array of verified users
   */
  async findAllVerified(): Promise<User[]> {
    const query = 'SELECT * FROM users WHERE verified_at IS NOT NULL ORDER BY verified_at DESC';
    const result = await this.pool.query<User>(query);
    return result.rows;
  }
}
