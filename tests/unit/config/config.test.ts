/**
 * Unit tests for configuration module
 * Tests written FIRST per ADR-014 (TDD)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, resetConfig } from '../../../src/config/index.js';

describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    resetConfig();
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    resetConfig();
  });

  describe('loadConfig', () => {
    it('should load valid configuration from environment variables', () => {
      // Arrange
      process.env.SERVICE_NAME = 'whatsapp-handler';
      process.env.DATABASE_SCHEMA = 'whatsapp_handler';
      process.env.NODE_ENV = 'test';
      process.env.PORT = '3000';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.REDIS_CACHE_TTL_SECONDS = '86400';
      process.env.TWILIO_ACCOUNT_SID = 'AC123';
      process.env.TWILIO_AUTH_TOKEN = 'test_token';
      process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';
      process.env.LOKI_HOST = 'https://loki.example.com';
      process.env.LOKI_BASIC_AUTH = '1234:token';
      process.env.ALLOY_PUSH_URL = 'http://alloy:9091';
      process.env.METRICS_PORT = '9090';

      // Act
      const config = loadConfig();

      // Assert
      expect(config.serviceName).toBe('whatsapp-handler');
      expect(config.databaseSchema).toBe('whatsapp_handler');
      expect(config.nodeEnv).toBe('test');
      expect(config.port).toBe(3000);
      expect(config.database.url).toBe('postgresql://user:pass@localhost:5432/db');
      expect(config.redis.url).toBe('redis://localhost:6379');
      expect(config.redis.cacheTtlSeconds).toBe(86400);
      expect(config.twilio.accountSid).toBe('AC123');
      expect(config.twilio.authToken).toBe('test_token');
      expect(config.twilio.whatsappNumber).toBe('whatsapp:+14155238886');
      expect(config.observability.loki.host).toBe('https://loki.example.com');
      expect(config.observability.loki.basicAuth).toBe('1234:token');
      expect(config.observability.alloyPushUrl).toBe('http://alloy:9091');
      expect(config.observability.metricsPort).toBe(9090);
    });

    it('should throw error when required SERVICE_NAME is missing', () => {
      // Arrange
      delete process.env.SERVICE_NAME;
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.TWILIO_ACCOUNT_SID = 'AC123';
      process.env.TWILIO_AUTH_TOKEN = 'token';
      process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';

      // Act & Assert
      expect(() => loadConfig()).toThrow();
    });

    it('should throw error when required DATABASE_URL is missing', () => {
      // Arrange
      process.env.SERVICE_NAME = 'whatsapp-handler';
      delete process.env.DATABASE_URL;

      // Act & Assert
      expect(() => loadConfig()).toThrow();
    });

    it('should throw error when required TWILIO_ACCOUNT_SID is missing', () => {
      // Arrange
      process.env.SERVICE_NAME = 'whatsapp-handler';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.REDIS_URL = 'redis://localhost:6379';
      delete process.env.TWILIO_ACCOUNT_SID;

      // Act & Assert
      expect(() => loadConfig()).toThrow();
    });

    it('should use default values when optional variables are missing', () => {
      // Arrange
      process.env.SERVICE_NAME = 'whatsapp-handler';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.TWILIO_ACCOUNT_SID = 'AC123';
      process.env.TWILIO_AUTH_TOKEN = 'token';
      process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';
      delete process.env.DATABASE_SCHEMA;
      delete process.env.NODE_ENV;
      delete process.env.PORT;
      delete process.env.REDIS_CACHE_TTL_SECONDS;

      // Act
      const config = loadConfig();

      // Assert
      expect(config.databaseSchema).toBe('whatsapp_handler'); // default
      expect(config.nodeEnv).toBe('development'); // default
      expect(config.port).toBe(3000); // default
      expect(config.redis.cacheTtlSeconds).toBe(86400); // default 24h
    });

    it('should validate PORT is a valid number', () => {
      // Arrange
      process.env.SERVICE_NAME = 'whatsapp-handler';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.TWILIO_ACCOUNT_SID = 'AC123';
      process.env.TWILIO_AUTH_TOKEN = 'token';
      process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';
      process.env.PORT = 'not_a_number';

      // Act & Assert
      expect(() => loadConfig()).toThrow();
    });

    it('should validate REDIS_CACHE_TTL_SECONDS is a valid number', () => {
      // Arrange
      process.env.SERVICE_NAME = 'whatsapp-handler';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.TWILIO_ACCOUNT_SID = 'AC123';
      process.env.TWILIO_AUTH_TOKEN = 'token';
      process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';
      process.env.REDIS_CACHE_TTL_SECONDS = 'invalid';

      // Act & Assert
      expect(() => loadConfig()).toThrow();
    });

    it('should validate TWILIO_WHATSAPP_NUMBER format', () => {
      // Arrange
      process.env.SERVICE_NAME = 'whatsapp-handler';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.TWILIO_ACCOUNT_SID = 'AC123';
      process.env.TWILIO_AUTH_TOKEN = 'token';
      process.env.TWILIO_WHATSAPP_NUMBER = 'invalid_format';

      // Act & Assert
      expect(() => loadConfig()).toThrow();
    });
  });
});
