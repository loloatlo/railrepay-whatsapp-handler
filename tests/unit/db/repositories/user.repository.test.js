/**
 * Unit tests for UserRepository
 * Tests FIRST (TDD per ADR-014)
 *
 * Per specification §4.2: User authentication and phone number verification
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
describe('UserRepository', () => {
    let mockPool;
    let mockQuery;
    beforeEach(() => {
        mockQuery = vi.fn();
        mockPool = {
            query: mockQuery,
        };
    });
    describe('create', () => {
        it('should create a new user with valid phone number', async () => {
            // Arrange
            const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
            const repo = new UserRepository(mockPool);
            const createData = {
                phone_number: '+447700900123',
                display_name: 'Test User',
            };
            const mockUser = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                phone_number: '+447700900123',
                display_name: 'Test User',
                verified_at: null,
                registered_at: new Date('2025-11-30T12:00:00Z'),
                last_active_at: null,
                otp_secret: null,
                otp_verified_at: null,
                terms_accepted_at: null,
                terms_version: null,
                blocked_at: null,
                block_reason: null,
                created_at: new Date('2025-11-30T12:00:00Z'),
                updated_at: new Date('2025-11-30T12:00:00Z'),
            };
            mockQuery.mockResolvedValueOnce({
                rows: [mockUser],
                rowCount: 1,
            });
            // Act
            const result = await repo.create(createData);
            // Assert
            expect(result).toEqual(mockUser);
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), expect.arrayContaining(['+447700900123', 'Test User']));
        });
        it('should throw ConflictError on duplicate phone number', async () => {
            // Arrange
            const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
            const repo = new UserRepository(mockPool);
            const createData = {
                phone_number: '+447700900123',
            };
            // Simulate PostgreSQL unique constraint violation (error code 23505)
            const pgError = new Error('duplicate key value violates unique constraint');
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
            const mockUser = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                phone_number: '+447700900123',
                display_name: 'Test User',
                verified_at: new Date('2025-11-30T12:00:00Z'),
                registered_at: new Date('2025-11-30T11:00:00Z'),
                last_active_at: new Date('2025-11-30T12:00:00Z'),
                otp_secret: null,
                otp_verified_at: new Date('2025-11-30T12:00:00Z'),
                terms_accepted_at: new Date('2025-11-30T11:00:00Z'),
                terms_version: '1.0',
                blocked_at: null,
                block_reason: null,
                created_at: new Date('2025-11-30T11:00:00Z'),
                updated_at: new Date('2025-11-30T12:00:00Z'),
            };
            mockQuery.mockResolvedValueOnce({
                rows: [mockUser],
                rowCount: 1,
            });
            // Act
            const result = await repo.findByPhone('+447700900123');
            // Assert
            expect(result).toEqual(mockUser);
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM users WHERE phone_number ='), ['+447700900123']);
        });
        it('should return null when phone number does not exist', async () => {
            // Arrange
            const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
            const repo = new UserRepository(mockPool);
            mockQuery.mockResolvedValueOnce({
                rows: [],
                rowCount: 0,
            });
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
            const mockUser = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                phone_number: '+447700900123',
                display_name: 'Test User',
                verified_at: new Date('2025-11-30T12:00:00Z'),
                registered_at: new Date('2025-11-30T11:00:00Z'),
                last_active_at: new Date('2025-11-30T12:00:00Z'),
                otp_secret: null,
                otp_verified_at: new Date('2025-11-30T12:00:00Z'),
                terms_accepted_at: new Date('2025-11-30T11:00:00Z'),
                terms_version: '1.0',
                blocked_at: null,
                block_reason: null,
                created_at: new Date('2025-11-30T11:00:00Z'),
                updated_at: new Date('2025-11-30T12:00:00Z'),
            };
            mockQuery.mockResolvedValueOnce({
                rows: [mockUser],
                rowCount: 1,
            });
            // Act
            const result = await repo.findById('123e4567-e89b-12d3-a456-426614174000');
            // Assert
            expect(result).toEqual(mockUser);
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM users WHERE id ='), ['123e4567-e89b-12d3-a456-426614174000']);
        });
        it('should return null when id does not exist', async () => {
            // Arrange
            const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
            const repo = new UserRepository(mockPool);
            mockQuery.mockResolvedValueOnce({
                rows: [],
                rowCount: 0,
            });
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
            const updateData = {
                verified_at: new Date('2025-11-30T12:00:00Z'),
                otp_verified_at: new Date('2025-11-30T12:00:00Z'),
                last_active_at: new Date('2025-11-30T12:00:00Z'),
            };
            const mockUpdatedUser = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                phone_number: '+447700900123',
                display_name: 'Test User',
                verified_at: new Date('2025-11-30T12:00:00Z'),
                registered_at: new Date('2025-11-30T11:00:00Z'),
                last_active_at: new Date('2025-11-30T12:00:00Z'),
                otp_secret: null,
                otp_verified_at: new Date('2025-11-30T12:00:00Z'),
                terms_accepted_at: new Date('2025-11-30T11:00:00Z'),
                terms_version: '1.0',
                blocked_at: null,
                block_reason: null,
                created_at: new Date('2025-11-30T11:00:00Z'),
                updated_at: new Date('2025-11-30T12:00:00Z'),
            };
            mockQuery.mockResolvedValueOnce({
                rows: [mockUpdatedUser],
                rowCount: 1,
            });
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
            });
            // Act
            const result = await repo.update('nonexistent-id', { display_name: 'New Name' });
            // Assert
            expect(result).toBeNull();
        });
    });
    describe('softDelete', () => {
        it('should set blocked_at and block_reason on soft delete', async () => {
            // Arrange
            const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
            const repo = new UserRepository(mockPool);
            const mockBlockedUser = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                phone_number: '+447700900123',
                display_name: 'Test User',
                verified_at: new Date('2025-11-30T12:00:00Z'),
                registered_at: new Date('2025-11-30T11:00:00Z'),
                last_active_at: new Date('2025-11-30T12:00:00Z'),
                otp_secret: null,
                otp_verified_at: new Date('2025-11-30T12:00:00Z'),
                terms_accepted_at: new Date('2025-11-30T11:00:00Z'),
                terms_version: '1.0',
                blocked_at: new Date('2025-11-30T13:00:00Z'),
                block_reason: 'User requested account deletion',
                created_at: new Date('2025-11-30T11:00:00Z'),
                updated_at: new Date('2025-11-30T13:00:00Z'),
            };
            mockQuery.mockResolvedValueOnce({
                rows: [mockBlockedUser],
                rowCount: 1,
            });
            // Act
            const result = await repo.softDelete('123e4567-e89b-12d3-a456-426614174000', 'User requested account deletion');
            // Assert
            expect(result).toEqual(mockBlockedUser);
            expect(result?.blocked_at).not.toBeNull();
            expect(result?.block_reason).toBe('User requested account deletion');
            expect(mockQuery).toHaveBeenCalled();
            expect(mockQuery.mock.calls[0][1]).toContain('User requested account deletion');
        });
    });
    describe('hardDelete', () => {
        it('should permanently delete user (GDPR)', async () => {
            // Arrange
            const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
            const repo = new UserRepository(mockPool);
            mockQuery.mockResolvedValueOnce({
                rows: [],
                rowCount: 1,
            });
            // Act
            const result = await repo.hardDelete('123e4567-e89b-12d3-a456-426614174000');
            // Assert
            expect(result).toBe(true);
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM users WHERE id ='), ['123e4567-e89b-12d3-a456-426614174000']);
        });
        it('should return false when user to delete does not exist', async () => {
            // Arrange
            const { UserRepository } = await import('../../../../src/db/repositories/user.repository.js');
            const repo = new UserRepository(mockPool);
            mockQuery.mockResolvedValueOnce({
                rows: [],
                rowCount: 0,
            });
            // Act
            const result = await repo.hardDelete('nonexistent-id');
            // Assert
            expect(result).toBe(false);
        });
    });
});
//# sourceMappingURL=user.repository.test.js.map