/**
 * Unit tests for PreferencesRepository v2.0
 * Per ADR-014 (TDD): Tests written BEFORE implementation
 * Per ADR-004: Using Vitest test framework
 *
 * SPEC: Notion › Architecture › Data Layer › whatsapp_handler.user_preferences
 * RFC: RFC-whatsapp-handler-schema-v2.md § 2.2 User Preferences
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { PreferencesRepository } from '../../../../src/db/repositories/preferences.repository';
import type { UserPreference, CreateUserPreferenceDTO } from '../../../../src/db/types.v2';

describe('PreferencesRepository v2.0', () => {
  let mockPool: Pool;
  let mockClient: PoolClient;
  let repository: PreferencesRepository;

  const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440001';
  const TEST_PREF_ID = '550e8400-e29b-41d4-a716-446655440099';

  beforeEach(() => {
    // Mock PoolClient
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    } as unknown as PoolClient;

    // Mock Pool
    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn(),
    } as unknown as Pool;

    repository = new PreferencesRepository(mockPool);
  });

  describe('getUserPreferences', () => {
    it('should return all preferences for a user', async () => {
      // Arrange
      const mockPreferences: UserPreference[] = [
        {
          id: TEST_PREF_ID,
          user_id: TEST_USER_ID,
          preference_key: 'language',
          preference_value: 'en',
          created_at: new Date('2025-01-01T10:00:00Z'),
          updated_at: new Date('2025-01-01T10:00:00Z'),
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440098',
          user_id: TEST_USER_ID,
          preference_key: 'notification_enabled',
          preference_value: 'true',
          created_at: new Date('2025-01-01T10:00:00Z'),
          updated_at: new Date('2025-01-01T10:00:00Z'),
        },
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockPreferences,
        command: 'SELECT',
        rowCount: 2,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.getUserPreferences(TEST_USER_ID);

      // Assert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, user_id, preference_key, preference_value, created_at, updated_at'),
        [TEST_USER_ID]
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM whatsapp_handler.user_preferences'),
        [TEST_USER_ID]
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1'),
        [TEST_USER_ID]
      );
      expect(result).toEqual(mockPreferences);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when user has no preferences', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.getUserPreferences(TEST_USER_ID);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database connection failed'));

      // Act & Assert
      await expect(repository.getUserPreferences(TEST_USER_ID)).rejects.toThrow('Database connection failed');
    });
  });

  describe('getPreference', () => {
    it('should return a specific preference by key', async () => {
      // Arrange
      const mockPreference: UserPreference = {
        id: TEST_PREF_ID,
        user_id: TEST_USER_ID,
        preference_key: 'language',
        preference_value: 'en',
        created_at: new Date('2025-01-01T10:00:00Z'),
        updated_at: new Date('2025-01-01T10:00:00Z'),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockPreference],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.getPreference(TEST_USER_ID, 'language');

      // Assert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND preference_key = $2'),
        [TEST_USER_ID, 'language']
      );
      expect(result).toEqual(mockPreference);
    });

    it('should return null when preference does not exist', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.getPreference(TEST_USER_ID, 'non_existent_key');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('setPreference', () => {
    it('should insert a new preference when it does not exist', async () => {
      // Arrange
      const createDTO: CreateUserPreferenceDTO = {
        user_id: TEST_USER_ID,
        preference_key: 'language',
        preference_value: 'en',
      };

      const mockCreatedPreference: UserPreference = {
        id: TEST_PREF_ID,
        ...createDTO,
        created_at: new Date('2025-01-01T10:00:00Z'),
        updated_at: new Date('2025-01-01T10:00:00Z'),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockCreatedPreference],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.setPreference(TEST_USER_ID, 'language', 'en');

      // Assert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO whatsapp_handler.user_preferences'),
        [TEST_USER_ID, 'language', 'en']
      );
      expect(result).toEqual(mockCreatedPreference);
    });

    it('should update an existing preference when key already exists', async () => {
      // Arrange
      const updatedPreference: UserPreference = {
        id: TEST_PREF_ID,
        user_id: TEST_USER_ID,
        preference_key: 'language',
        preference_value: 'es', // Updated value
        created_at: new Date('2025-01-01T10:00:00Z'),
        updated_at: new Date('2025-01-01T11:00:00Z'), // Updated timestamp
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [updatedPreference],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.setPreference(TEST_USER_ID, 'language', 'es');

      // Assert - Verify UPSERT query structure
      const callArgs = vi.mocked(mockPool.query).mock.calls[0];
      expect(callArgs[0]).toContain('INSERT INTO whatsapp_handler.user_preferences');
      expect(callArgs[0]).toContain('ON CONFLICT (user_id, preference_key)');
      expect(callArgs[0]).toContain('DO UPDATE');
      expect(callArgs[1]).toEqual([TEST_USER_ID, 'language', 'es']);
      expect(result.preference_value).toBe('es');
    });

    it('should throw error when foreign key constraint fails', async () => {
      // Arrange - Non-existent user_id
      const dbError = new Error('Foreign key violation') as any;
      dbError.code = '23503'; // PostgreSQL foreign key violation code

      vi.mocked(mockPool.query).mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(repository.setPreference('non-existent-user-id', 'language', 'en')).rejects.toThrow(
        'Foreign key violation'
      );
    });
  });

  describe('deletePreference', () => {
    it('should delete a preference by user_id and key', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'DELETE',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.deletePreference(TEST_USER_ID, 'language');

      // Assert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM whatsapp_handler.user_preferences'),
        [TEST_USER_ID, 'language']
      );
      expect(result).toBe(true);
    });

    it('should return false when preference does not exist', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'DELETE',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.deletePreference(TEST_USER_ID, 'non_existent_key');

      // Assert
      expect(result).toBe(false);
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database connection lost'));

      // Act & Assert
      await expect(repository.deletePreference(TEST_USER_ID, 'language')).rejects.toThrow('Database connection lost');
    });
  });

  describe('deleteAllUserPreferences', () => {
    it('should delete all preferences for a user', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'DELETE',
        rowCount: 3, // 3 preferences deleted
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.deleteAllUserPreferences(TEST_USER_ID);

      // Assert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM whatsapp_handler.user_preferences'),
        [TEST_USER_ID]
      );
      expect(result).toBe(3);
    });

    it('should return 0 when user has no preferences to delete', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'DELETE',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.deleteAllUserPreferences(TEST_USER_ID);

      // Assert
      expect(result).toBe(0);
    });
  });
});
