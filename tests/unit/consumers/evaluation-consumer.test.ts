/**
 * Evaluation Consumer Unit Tests
 *
 * Phase TD-1: Failing tests for BL-148 / TD-WHATSAPP-060
 * AC-1: whatsapp-handler creates a Kafka consumer on startup
 * AC-2: Kafka consumer subscribes to evaluation.completed topic with groupId whatsapp-handler-evaluation-completed
 * AC-11: Graceful shutdown disconnects Kafka consumer before process exit
 *
 * Tests the EventConsumer wrapper that manages KafkaConsumer lifecycle.
 * Pattern reference: evaluation-coordinator/src/consumers/event-consumer.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @railrepay/kafka-client
vi.mock('@railrepay/kafka-client', () => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockDisconnect = vi.fn().mockResolvedValue(undefined);
  const mockSubscribe = vi.fn().mockResolvedValue(undefined);
  const mockStart = vi.fn().mockResolvedValue(undefined);
  const mockGetStats = vi.fn().mockReturnValue({
    processedCount: 0,
    errorCount: 0,
    lastProcessedAt: null,
    isRunning: false,
  });
  const mockIsConsumerRunning = vi.fn().mockReturnValue(false);

  const MockKafkaConsumer = vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    subscribe: mockSubscribe,
    start: mockStart,
    getStats: mockGetStats,
    isConsumerRunning: mockIsConsumerRunning,
  }));

  // Attach mocks for test access
  (MockKafkaConsumer as any)._mockConnect = mockConnect;
  (MockKafkaConsumer as any)._mockDisconnect = mockDisconnect;
  (MockKafkaConsumer as any)._mockSubscribe = mockSubscribe;
  (MockKafkaConsumer as any)._mockStart = mockStart;
  (MockKafkaConsumer as any)._mockGetStats = mockGetStats;
  (MockKafkaConsumer as any)._mockIsConsumerRunning = mockIsConsumerRunning;

  return { KafkaConsumer: MockKafkaConsumer };
});

import { KafkaConsumer } from '@railrepay/kafka-client';
import { EvaluationConsumer, EvaluationConsumerConfig } from '../../../src/consumers/evaluation-consumer.js';

describe('EvaluationConsumer', () => {
  let consumer: EvaluationConsumer;
  let mockConnect: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let mockSubscribe: ReturnType<typeof vi.fn>;
  let mockStart: ReturnType<typeof vi.fn>;
  let mockIsConsumerRunning: ReturnType<typeof vi.fn>;

  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  const mockHandler = vi.fn().mockResolvedValue(undefined);

  const validConfig: EvaluationConsumerConfig = {
    serviceName: 'whatsapp-handler',
    brokers: ['broker1:9092'],
    username: 'testuser',
    password: 'testpass',
    groupId: 'whatsapp-handler-evaluation-completed',
    logger: mockLogger,
    handler: mockHandler,
    ssl: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const KafkaConsumerMock = KafkaConsumer as any;
    mockConnect = KafkaConsumerMock._mockConnect;
    mockDisconnect = KafkaConsumerMock._mockDisconnect;
    mockSubscribe = KafkaConsumerMock._mockSubscribe;
    mockStart = KafkaConsumerMock._mockStart;
    mockIsConsumerRunning = KafkaConsumerMock._mockIsConsumerRunning;

    consumer = new EvaluationConsumer(validConfig);
  });

  // AC-1: Creates a Kafka consumer
  describe('constructor (AC-1)', () => {
    it('AC-1: should create a KafkaConsumer instance with correct config', () => {
      expect(KafkaConsumer).toHaveBeenCalledWith({
        serviceName: 'whatsapp-handler',
        brokers: ['broker1:9092'],
        username: 'testuser',
        password: 'testpass',
        groupId: 'whatsapp-handler-evaluation-completed',
        logger: mockLogger,
        ssl: true,
      });
    });

    it('AC-1: should create consumer with single KafkaConsumer instance (single topic)', () => {
      // Unlike evaluation-coordinator which has 2 topics, whatsapp-handler has only 1
      expect(KafkaConsumer).toHaveBeenCalledTimes(1);
    });
  });

  // AC-2: Subscribes to evaluation.completed topic
  describe('start (AC-2)', () => {
    it('AC-2: should connect to Kafka broker', async () => {
      await consumer.start();

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('AC-2: should subscribe to evaluation.completed topic', async () => {
      await consumer.start();

      expect(mockSubscribe).toHaveBeenCalledTimes(1);
      expect(mockSubscribe).toHaveBeenCalledWith(
        'evaluation.completed',
        expect.any(Function)
      );
    });

    it('AC-2: should call KafkaConsumer.start() after subscribe (v2.0.0 two-step API)', async () => {
      await consumer.start();

      expect(mockStart).toHaveBeenCalledTimes(1);
      // start() must be called AFTER subscribe()
      const subscribeOrder = mockSubscribe.mock.invocationCallOrder[0];
      const startOrder = mockStart.mock.invocationCallOrder[0];
      expect(startOrder).toBeGreaterThan(subscribeOrder);
    });

    it('AC-2: should parse message value and pass payload to handler', async () => {
      let subscribedHandler: Function;
      mockSubscribe.mockImplementation(async (_topic: string, handler: Function) => {
        subscribedHandler = handler;
      });

      await consumer.start();

      // Simulate incoming Kafka message
      const testPayload = {
        journey_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        eligible: true,
        scheme: 'DR30',
        compensation_pence: 2500,
        correlation_id: '123e4567-e89b-12d3-a456-426614174002',
      };

      await subscribedHandler!({
        topic: 'evaluation.completed',
        partition: 0,
        message: {
          key: null,
          value: Buffer.from(JSON.stringify(testPayload)),
          offset: '0',
          timestamp: Date.now().toString(),
          headers: {},
        },
      });

      expect(mockHandler).toHaveBeenCalledWith(testPayload);
    });

    it('AC-2: should handle empty message value gracefully', async () => {
      let subscribedHandler: Function;
      mockSubscribe.mockImplementation(async (_topic: string, handler: Function) => {
        subscribedHandler = handler;
      });

      await consumer.start();

      await subscribedHandler!({
        topic: 'evaluation.completed',
        partition: 0,
        message: {
          key: null,
          value: null,
          offset: '0',
          timestamp: Date.now().toString(),
          headers: {},
        },
      });

      // Should log error but not call handler
      expect(mockHandler).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Empty message'),
        expect.any(Object)
      );
    });

    it('AC-2: should handle malformed JSON in message value', async () => {
      let subscribedHandler: Function;
      mockSubscribe.mockImplementation(async (_topic: string, handler: Function) => {
        subscribedHandler = handler;
      });

      await consumer.start();

      await subscribedHandler!({
        topic: 'evaluation.completed',
        partition: 0,
        message: {
          key: null,
          value: Buffer.from('not valid json'),
          offset: '0',
          timestamp: Date.now().toString(),
          headers: {},
        },
      });

      // Should log error but not throw
      expect(mockHandler).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('parse'),
        expect.any(Object)
      );
    });

    it('AC-2: should track processed message statistics', async () => {
      let subscribedHandler: Function;
      mockSubscribe.mockImplementation(async (_topic: string, handler: Function) => {
        subscribedHandler = handler;
      });

      await consumer.start();

      // Process a valid message
      const testPayload = {
        journey_id: 'j1',
        user_id: 'u1',
        eligible: true,
        scheme: 'DR30',
        compensation_pence: 2500,
        correlation_id: 'c1',
      };

      await subscribedHandler!({
        topic: 'evaluation.completed',
        partition: 0,
        message: {
          key: null,
          value: Buffer.from(JSON.stringify(testPayload)),
          offset: '0',
          timestamp: Date.now().toString(),
          headers: {},
        },
      });

      const stats = consumer.getStats();
      expect(stats.processedCount).toBe(1);
    });

    it('AC-2: should throw when Kafka connection fails', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(consumer.start()).rejects.toThrow('Connection refused');
    });

    it('AC-2: should log Kafka connection', async () => {
      await consumer.start();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Connecting'),
        expect.any(Object)
      );
    });
  });

  // AC-11: Graceful shutdown disconnects Kafka consumer
  describe('stop (AC-11)', () => {
    it('AC-11: should disconnect from Kafka on stop', async () => {
      mockIsConsumerRunning.mockReturnValue(true);
      await consumer.start();

      await consumer.stop();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('AC-11: should log shutdown', async () => {
      mockIsConsumerRunning.mockReturnValue(true);
      await consumer.start();

      await consumer.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Shutting down'),
        expect.any(Object)
      );
    });

    it('AC-11: should handle stop when not started gracefully', async () => {
      // Should not throw
      await expect(consumer.stop()).resolves.toBeUndefined();
    });

    it('AC-11: should handle disconnect errors gracefully without throwing', async () => {
      mockIsConsumerRunning.mockReturnValue(true);
      await consumer.start();

      mockDisconnect.mockRejectedValueOnce(new Error('Disconnect failed'));

      // Should not throw - graceful shutdown
      await expect(consumer.stop()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error'),
        expect.any(Object)
      );
    });

    it('AC-11: should update isRunning state after stop', async () => {
      mockIsConsumerRunning.mockReturnValue(true);
      await consumer.start();

      expect(consumer.isRunning()).toBe(true);

      mockIsConsumerRunning.mockReturnValue(false);
      await consumer.stop();

      expect(consumer.isRunning()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return initial stats when not started', () => {
      const stats = consumer.getStats();

      expect(stats.processedCount).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.lastProcessedAt).toBeNull();
      expect(stats.isRunning).toBe(false);
    });
  });

  describe('isRunning', () => {
    it('should return false when not started', () => {
      expect(consumer.isRunning()).toBe(false);
    });

    it('should return true after successful start', async () => {
      mockIsConsumerRunning.mockReturnValue(true);
      await consumer.start();

      expect(consumer.isRunning()).toBe(true);
    });
  });
});
