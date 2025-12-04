/**
 * Unit tests for database client
 * Tests FIRST (TDD per ADR-014)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Create mock functions at module scope
const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockOn = vi.fn();
// Mock pg module
vi.mock('pg', () => {
    return {
        Pool: vi.fn(() => ({
            query: mockQuery,
            connect: mockConnect,
            end: mockEnd,
            on: mockOn,
            totalCount: 0,
            idleCount: 0,
            waitingCount: 0,
        })),
    };
});
describe('DatabaseClient', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    describe('createDatabaseClient', () => {
        it('should create a pool with correct configuration', async () => {
            // Arrange
            const { createDatabaseClient } = await import('../../../src/db/client.js');
            const config = {
                host: 'localhost',
                port: 5432,
                database: 'test_db',
                user: 'test_user',
                password: 'test_password',
                schema: 'whatsapp_handler',
            };
            // Act
            const client = createDatabaseClient(config);
            // Assert
            expect(client).toBeDefined();
            expect(client.query).toBeDefined();
        });
        it('should set search_path to service schema on initialization', async () => {
            // Arrange
            const { createDatabaseClient } = await import('../../../src/db/client.js');
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
            const config = {
                host: 'localhost',
                port: 5432,
                database: 'test_db',
                user: 'test_user',
                password: 'test_password',
                schema: 'whatsapp_handler',
            };
            // Act
            const client = createDatabaseClient(config);
            await client.initialize();
            // Assert
            expect(mockQuery).toHaveBeenCalledWith('SET search_path TO whatsapp_handler, public');
        });
        it('should provide a query method that delegates to pool', async () => {
            // Arrange
            const { createDatabaseClient } = await import('../../../src/db/client.js');
            const mockResult = { rows: [{ id: '123' }], rowCount: 1 };
            mockQuery.mockResolvedValueOnce(mockResult);
            const client = createDatabaseClient({
                host: 'localhost',
                port: 5432,
                database: 'test_db',
                user: 'test_user',
                password: 'test_password',
                schema: 'whatsapp_handler',
            });
            // Act
            const result = await client.query('SELECT * FROM users WHERE id = $1', ['123']);
            // Assert
            expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', ['123']);
            expect(result).toEqual(mockResult);
        });
        it('should provide a disconnect method that ends the pool', async () => {
            // Arrange
            const { createDatabaseClient } = await import('../../../src/db/client.js');
            mockEnd.mockResolvedValueOnce(undefined);
            const client = createDatabaseClient({
                host: 'localhost',
                port: 5432,
                database: 'test_db',
                user: 'test_user',
                password: 'test_password',
                schema: 'whatsapp_handler',
            });
            // Act
            await client.disconnect();
            // Assert
            expect(mockEnd).toHaveBeenCalled();
        });
        it('should handle connection errors gracefully', async () => {
            // Arrange
            const { createDatabaseClient } = await import('../../../src/db/client.js');
            const connectionError = new Error('Connection failed');
            mockQuery.mockRejectedValueOnce(connectionError);
            const client = createDatabaseClient({
                host: 'localhost',
                port: 5432,
                database: 'test_db',
                user: 'test_user',
                password: 'test_password',
                schema: 'whatsapp_handler',
            });
            // Act & Assert
            await expect(client.initialize()).rejects.toThrow('Connection failed');
        });
    });
    describe('health check', () => {
        it('should return true when database is healthy', async () => {
            // Arrange
            const { createDatabaseClient } = await import('../../../src/db/client.js');
            mockQuery.mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 });
            const client = createDatabaseClient({
                host: 'localhost',
                port: 5432,
                database: 'test_db',
                user: 'test_user',
                password: 'test_password',
                schema: 'whatsapp_handler',
            });
            // Act
            const isHealthy = await client.healthCheck();
            // Assert
            expect(isHealthy).toBe(true);
            expect(mockQuery).toHaveBeenCalledWith('SELECT 1 as result');
        });
        it('should return false when database is unhealthy', async () => {
            // Arrange
            const { createDatabaseClient } = await import('../../../src/db/client.js');
            mockQuery.mockRejectedValueOnce(new Error('Connection timeout'));
            const client = createDatabaseClient({
                host: 'localhost',
                port: 5432,
                database: 'test_db',
                user: 'test_user',
                password: 'test_password',
                schema: 'whatsapp_handler',
            });
            // Act
            const isHealthy = await client.healthCheck();
            // Assert
            expect(isHealthy).toBe(false);
        });
    });
});
//# sourceMappingURL=client.test.js.map