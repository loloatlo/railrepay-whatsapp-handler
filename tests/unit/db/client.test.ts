/**
 * Unit tests for database client
 * Tests FIRST (TDD per ADR-014)
 *
 * UPDATED: Now tests @railrepay/postgres-client wrapper
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';

// Create mock functions at module scope
const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockHealthCheck = vi.fn();
const mockGetPool = vi.fn();

// Mock @railrepay/postgres-client module
vi.mock('@railrepay/postgres-client', () => {
  return {
    PostgresClient: vi.fn().mockImplementation(() => ({
      connect: mockConnect,
      disconnect: mockDisconnect,
      query: mockQuery,
      healthCheck: mockHealthCheck,
      getPool: mockGetPool.mockReturnValue({
        query: vi.fn(),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
      }),
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
      mockConnect.mockResolvedValueOnce(undefined);

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

      // Assert: PostgresClient.connect() is called (which sets search_path internally)
      expect(mockConnect).toHaveBeenCalled();
    });

    it('should provide a query method that delegates to PostgresClient', async () => {
      // Arrange
      const { createDatabaseClient } = await import('../../../src/db/client.js');
      // PostgresClient.query() returns an array, not a QueryResult object
      mockQuery.mockResolvedValueOnce([{ id: '123' }]);

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
      expect(result.rows).toEqual([{ id: '123' }]);
      expect(result.rowCount).toBe(1);
    });

    it('should provide a disconnect method that disconnects PostgresClient', async () => {
      // Arrange
      const { createDatabaseClient } = await import('../../../src/db/client.js');
      mockDisconnect.mockResolvedValueOnce(undefined);

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
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      // Arrange
      const { createDatabaseClient } = await import('../../../src/db/client.js');
      const connectionError = new Error('Connection failed');
      mockConnect.mockRejectedValueOnce(connectionError);

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
      mockHealthCheck.mockResolvedValueOnce(true);

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
      expect(mockHealthCheck).toHaveBeenCalled();
    });

    it('should return false when database is unhealthy', async () => {
      // Arrange
      const { createDatabaseClient } = await import('../../../src/db/client.js');
      mockHealthCheck.mockResolvedValueOnce(false);

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
