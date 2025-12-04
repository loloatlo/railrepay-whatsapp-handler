/**
 * Unit tests for UserRepository v2.0 (SIMPLIFIED SCHEMA)
 * Tests FIRST (TDD per ADR-014)
 *
 * Per RFC-whatsapp-handler-schema-v2.md:
 * - ONLY 5 columns in users table
 * - phone_number is unique identifier (E.164 format)
 * - verified_at set by Twilio Verify callback
 * - NO otp_secret, display_name, terms, blocked_at (moved to other services or removed)
 *
 * User Story References:
 * - RAILREPAY-001: First-time user registration
 * - RAILREPAY-002: Returning user authentication
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import { UserRepository, ConflictError } from '../../../../src/db/repositories/user.repository.v2.js';
import type { User, CreateUserDTO, UpdateUserDTO } from '../../../../src/db/types.v2.js';

describe('UserRepository v2.0 (Simplified Schema)', () => {
  let mockPool: Pool;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockQuery = vi.fn();
    mockPool = {
      query: mockQuery,
    } as unknown as Pool;
  });

  describe('create', () => {
    it('should create user with phone_number only (v2.0 schema)', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      const createData: CreateUserDTO = {
        phone_number: '+447700900123',
      };

      const mockUser: User = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        phone_number: '+447700900123',
        verified_at: null, // NULL until Twilio Verify callback
        created_at: new Date('2025-11-30T12:00:00Z'),
        updated_at: new Date('2025-11-30T12:00:00Z'),
      };

      mockQuery.mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as QueryResult);

      // Act
      const result = await repo.create(createData);

      // Assert
      expect(result).toEqual(mockUser);
      expect(result.verified_at).toBeNull(); // Not yet verified
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining(['+447700900123'])
      );
    });

    it('should throw ConflictError on duplicate phone number (unique constraint)', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      const createData: CreateUserDTO = {
        phone_number: '+447700900123',
      };

      // Simulate PostgreSQL unique constraint violation (code 23505)
      const pgError = new Error('duplicate key value violates unique constraint "users_phone_number_unique"') as any;
      pgError.code = '23505';
      mockQuery.mockRejectedValueOnce(pgError);

      // Act & Assert
      await expect(repo.create(createData)).rejects.toThrow('Phone number already registered');
    });

    it('should validate E.164 phone format (application layer)', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      const invalidPhones = [
        '07700900123', // Missing country code
        '447700900123', // Missing + symbol
        '+44 7700 900 123', // Spaces (not E.164)
        '(44) 7700 900 123', // Parentheses
      ];

      // Act & Assert
      for (const invalidPhone of invalidPhones) {
        await expect(
          repo.create({ phone_number: invalidPhone })
        ).rejects.toThrow(/Invalid phone number format/i);
      }
    });
  });

  describe('findByPhone', () => {
    it('should return user when phone number exists', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      const mockUser: User = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        phone_number: '+447700900123',
        verified_at: new Date('2025-11-30T12:00:00Z'),
        created_at: new Date('2025-11-30T11:00:00Z'),
        updated_at: new Date('2025-11-30T12:00:00Z'),
      };

      mockQuery.mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as QueryResult);

      // Act
      const result = await repo.findByPhone('+447700900123');

      // Assert
      expect(result).toEqual(mockUser);
      expect(result?.verified_at).not.toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM users WHERE phone_number ='),
        ['+447700900123']
      );
    });

    it('should return null when phone number does not exist', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as QueryResult);

      // Act
      const result = await repo.findByPhone('+447700900999');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return user when ID exists', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      const mockUser: User = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        phone_number: '+447700900123',
        verified_at: new Date('2025-11-30T12:00:00Z'),
        created_at: new Date('2025-11-30T11:00:00Z'),
        updated_at: new Date('2025-11-30T12:00:00Z'),
      };

      mockQuery.mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as QueryResult);

      // Act
      const result = await repo.findById('123e4567-e89b-12d3-a456-426614174000');

      // Assert
      expect(result).toEqual(mockUser);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM users WHERE id ='),
        ['123e4567-e89b-12d3-a456-426614174000']
      );
    });

    it('should return null when ID does not exist', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as QueryResult);

      // Act
      const result = await repo.findById('nonexistent-id');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update verified_at timestamp (Twilio Verify callback)', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      const updateData: UpdateUserDTO = {
        verified_at: new Date('2025-11-30T12:00:00Z'),
      };

      const mockUpdatedUser: User = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        phone_number: '+447700900123',
        verified_at: new Date('2025-11-30T12:00:00Z'),
        created_at: new Date('2025-11-30T11:00:00Z'),
        updated_at: new Date('2025-11-30T12:00:00Z'),
      };

      mockQuery.mockResolvedValueOnce({
        rows: [mockUpdatedUser],
        rowCount: 1,
      } as QueryResult);

      // Act
      const result = await repo.update('123e4567-e89b-12d3-a456-426614174000', updateData);

      // Assert
      expect(result).toEqual(mockUpdatedUser);
      expect(result?.verified_at).toEqual(new Date('2025-11-30T12:00:00Z'));
      expect(mockQuery).toHaveBeenCalled();
      expect(mockQuery.mock.calls[0][0]).toContain('UPDATE users');
      expect(mockQuery.mock.calls[0][0]).toContain('SET verified_at');
    });

    it('should return null when user to update does not exist', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as QueryResult);

      // Act
      const result = await repo.update('nonexistent-id', { verified_at: new Date() });

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findAllVerified', () => {
    it('should return only verified users (verified_at IS NOT NULL)', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      const mockVerifiedUsers: User[] = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          phone_number: '+447700900123',
          verified_at: new Date('2025-11-30T12:00:00Z'),
          created_at: new Date('2025-11-30T11:00:00Z'),
          updated_at: new Date('2025-11-30T12:00:00Z'),
        },
        {
          id: '223e4567-e89b-12d3-a456-426614174001',
          phone_number: '+447700900456',
          verified_at: new Date('2025-11-29T10:00:00Z'),
          created_at: new Date('2025-11-29T09:00:00Z'),
          updated_at: new Date('2025-11-29T10:00:00Z'),
        },
      ];

      mockQuery.mockResolvedValueOnce({
        rows: mockVerifiedUsers,
        rowCount: 2,
      } as QueryResult);

      // Act
      const result = await repo.findAllVerified();

      // Assert
      expect(result).toHaveLength(2);
      expect(result.every(user => user.verified_at !== null)).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE verified_at IS NOT NULL')
      );
    });
  });

  describe('delete (GDPR hard delete - v2.0 approach)', () => {
    it('should permanently delete user (GDPR compliance)', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as QueryResult);

      // Act
      const result = await repo.delete('123e4567-e89b-12d3-a456-426614174000');

      // Assert
      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM users WHERE id ='),
        ['123e4567-e89b-12d3-a456-426614174000']
      );
    });

    it('should return false when user to delete does not exist', async () => {
      // Arrange
      const repo = new UserRepository(mockPool);

      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as QueryResult);

      // Act
      const result = await repo.delete('nonexistent-id');

      // Assert
      expect(result).toBe(false);
    });

    it('should cascade delete user_preferences (FK constraint)', async () => {
      // This behavior is enforced by database FK constraint ON DELETE CASCADE
      // Repository just needs to delete the user
      // Database will automatically delete related preferences

      // Arrange
      const repo = new UserRepository(mockPool);

      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1, // User deleted (preferences auto-deleted by CASCADE)
      } as QueryResult);

      // Act
      const result = await repo.delete('123e4567-e89b-12d3-a456-426614174000');

      // Assert
      expect(result).toBe(true);
      // NOTE: CASCADE delete is verified in integration tests (TD-WHATSAPP-V2-004)
    });
  });
});
