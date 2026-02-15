/**
 * Consumer Config Unit Tests
 *
 * Phase TD-1: Failing tests for BL-148 / TD-WHATSAPP-060
 * AC-7: New Kafka env vars configured: KAFKA_BROKERS, KAFKA_USERNAME, KAFKA_PASSWORD, KAFKA_SSL, KAFKA_GROUP_ID
 *
 * Tests the Kafka consumer configuration parser that reads from environment variables.
 * Pattern reference: evaluation-coordinator/src/consumers/config.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import the module under test (will not exist until Blake implements)
import { createConsumerConfig, ConsumerConfigError } from '../../../src/consumers/config.js';

describe('Consumer Config (AC-7)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // AC-7: All required Kafka env vars must be present
  describe('createConsumerConfig', () => {
    it('AC-7: should return valid config when all required env vars are set', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9092';
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_PASSWORD = 'testpass';
      process.env.KAFKA_GROUP_ID = 'whatsapp-handler-evaluation-completed';
      process.env.SERVICE_NAME = 'whatsapp-handler';

      const config = createConsumerConfig();

      expect(config).toEqual({
        serviceName: 'whatsapp-handler',
        brokers: ['broker1:9092', 'broker2:9092'],
        username: 'testuser',
        password: 'testpass',
        groupId: 'whatsapp-handler-evaluation-completed',
        ssl: true, // default
      });
    });

    it('AC-7: should parse KAFKA_BROKERS as comma-separated list', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092, broker2:9092, broker3:9092';
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_PASSWORD = 'testpass';
      process.env.KAFKA_GROUP_ID = 'whatsapp-handler-evaluation-completed';

      const config = createConsumerConfig();

      expect(config.brokers).toEqual(['broker1:9092', 'broker2:9092', 'broker3:9092']);
    });

    it('AC-7: should parse single broker correctly', () => {
      process.env.KAFKA_BROKERS = 'single-broker:9092';
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_PASSWORD = 'testpass';
      process.env.KAFKA_GROUP_ID = 'whatsapp-handler-evaluation-completed';

      const config = createConsumerConfig();

      expect(config.brokers).toEqual(['single-broker:9092']);
    });

    it('AC-7: should default SSL to true', () => {
      process.env.KAFKA_BROKERS = 'broker:9092';
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_PASSWORD = 'testpass';
      process.env.KAFKA_GROUP_ID = 'whatsapp-handler-evaluation-completed';

      const config = createConsumerConfig();

      expect(config.ssl).toBe(true);
    });

    it('AC-7: should allow disabling SSL via KAFKA_SSL_ENABLED=false', () => {
      process.env.KAFKA_BROKERS = 'broker:9092';
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_PASSWORD = 'testpass';
      process.env.KAFKA_GROUP_ID = 'whatsapp-handler-evaluation-completed';
      process.env.KAFKA_SSL_ENABLED = 'false';

      const config = createConsumerConfig();

      expect(config.ssl).toBe(false);
    });

    it('AC-7: should default SERVICE_NAME to whatsapp-handler', () => {
      process.env.KAFKA_BROKERS = 'broker:9092';
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_PASSWORD = 'testpass';
      process.env.KAFKA_GROUP_ID = 'whatsapp-handler-evaluation-completed';
      delete process.env.SERVICE_NAME;

      const config = createConsumerConfig();

      expect(config.serviceName).toBe('whatsapp-handler');
    });

    it('AC-7: should throw ConsumerConfigError when KAFKA_BROKERS is missing', () => {
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_PASSWORD = 'testpass';
      process.env.KAFKA_GROUP_ID = 'test-group';
      delete process.env.KAFKA_BROKERS;

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_BROKERS/);
    });

    it('AC-7: should throw ConsumerConfigError when KAFKA_USERNAME is missing', () => {
      process.env.KAFKA_BROKERS = 'broker:9092';
      process.env.KAFKA_PASSWORD = 'testpass';
      process.env.KAFKA_GROUP_ID = 'test-group';
      delete process.env.KAFKA_USERNAME;

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_USERNAME/);
    });

    it('AC-7: should throw ConsumerConfigError when KAFKA_PASSWORD is missing', () => {
      process.env.KAFKA_BROKERS = 'broker:9092';
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_GROUP_ID = 'test-group';
      delete process.env.KAFKA_PASSWORD;

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_PASSWORD/);
    });

    it('AC-7: should throw ConsumerConfigError when KAFKA_GROUP_ID is missing', () => {
      process.env.KAFKA_BROKERS = 'broker:9092';
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_PASSWORD = 'testpass';
      delete process.env.KAFKA_GROUP_ID;

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_GROUP_ID/);
    });

    it('AC-7: should list all missing env vars in error message when multiple are missing', () => {
      delete process.env.KAFKA_BROKERS;
      delete process.env.KAFKA_USERNAME;
      delete process.env.KAFKA_PASSWORD;
      delete process.env.KAFKA_GROUP_ID;

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      try {
        createConsumerConfig();
      } catch (error) {
        expect((error as Error).message).toContain('KAFKA_BROKERS');
        expect((error as Error).message).toContain('KAFKA_USERNAME');
        expect((error as Error).message).toContain('KAFKA_PASSWORD');
        expect((error as Error).message).toContain('KAFKA_GROUP_ID');
      }
    });

    it('AC-7: should throw ConsumerConfigError for empty string env vars', () => {
      process.env.KAFKA_BROKERS = '';
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_PASSWORD = 'testpass';
      process.env.KAFKA_GROUP_ID = 'test-group';

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
    });

    it('AC-7: should throw ConsumerConfigError for whitespace-only env vars', () => {
      process.env.KAFKA_BROKERS = '   ';
      process.env.KAFKA_USERNAME = 'testuser';
      process.env.KAFKA_PASSWORD = 'testpass';
      process.env.KAFKA_GROUP_ID = 'test-group';

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
    });
  });

  describe('ConsumerConfigError', () => {
    it('should be an instance of Error', () => {
      const error = new ConsumerConfigError('test message');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ConsumerConfigError);
      expect(error.name).toBe('ConsumerConfigError');
      expect(error.message).toBe('test message');
    });
  });
});
