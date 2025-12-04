/**
 * Unit tests for UserRepository
 * Tests FIRST (TDD per ADR-014)
 *
 * Per specification §4.2: User authentication and phone number verification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import type { User, CreateUserDTO, UpdateUserDTO } from '../../../../src/db/types.js';

describe('UserRepository', () => {
  let mockPool: Pool;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockQuery = vi.fn();
    mockPool = {
      query: mockQuery,
    } as unknown as Pool;
  });

  describe('create', () => {
    it('should create a new user with valid phone number', async () => {
      // Arrange
      const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
      const repo = new UserRepository(mockPool);

      const createData: CreateUserDTO = {
        phone_number: '+447700900123',
      };

      const mockUser: User = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        phone_number: '+447700900123',
        verified_at: null,
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
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining(['+447700900123'])
      );
    });

    it('should throw ConflictError on duplicate phone number', async () => {
      // Arrange
      const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
      const repo = new UserRepository(mockPool);

      const createData: CreateUserDTO = {
        phone_number: '+447700900123',
      };

      // Simulate PostgreSQL unique constraint violation (error code 23505)
      const pgError = new Error('duplicate key value violates unique constraint') as any;
      pgError.code = '23505';
      mockQuery.mockRejectedValueOnce(pgError);

      // Act & Assert
      await expect(repo.create(createData)).rejects.toThrow('Phone number already registered');
    });
  });

  describe('findByPhone', () => {
    it('should return user when phone number exists', async () => {
      // Arrange
      const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
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
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM users WHERE phone_number ='),
        ['+447700900123']
      );
    });

    it('should return null when phone number does not exist', async () => {
      // Arrange
      const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
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
    it('should return user when id exists', async () => {
      // Arrange
      const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
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

    it('should return null when id does not exist', async () => {
      // Arrange
      const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
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
    it('should update user fields and return updated user', async () => {
      // Arrange
      const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
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
      expect(mockQuery).toHaveBeenCalled();
      expect(mockQuery.mock.calls[0][0]).toContain('UPDATE users');
      expect(mockQuery.mock.calls[0][0]).toContain('SET verified_at');
    });

    it('should return null when user to update does not exist', async () => {
      // Arrange
      const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
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

  // NOTE: softDelete removed in v2.0 (use hard delete for GDPR per RFC § 2.1)

  describe('delete (v2.0 - hard delete for GDPR)', () => {
    it('should permanently delete user (GDPR)', async () => {
      // Arrange
      const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
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
      const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
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
  });
});
