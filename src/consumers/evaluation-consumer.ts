/**
 * BL-148: Evaluation Consumer
 *
 * EventConsumer wrapper that manages KafkaConsumer lifecycle for the
 * evaluation.completed topic. Receives evaluation results from
 * evaluation-coordinator (via outbox-relay) and triggers proactive
 * WhatsApp notifications.
 *
 * AC-1: Creates Kafka consumer on startup
 * AC-2: Subscribes to evaluation.completed with groupId whatsapp-handler-evaluation-completed
 * AC-11: Graceful shutdown disconnects Kafka consumer
 *
 * Pattern reference: evaluation-coordinator/src/consumers/event-consumer.ts
 */

import { KafkaConsumer } from '@railrepay/kafka-client';

/**
 * Logger interface for dependency injection
 */
interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Handler function type for processed evaluation payloads
 */
type EvaluationHandler = (payload: Record<string, unknown>) => Promise<void>;

/**
 * EvaluationConsumer configuration
 */
export interface EvaluationConsumerConfig {
  serviceName: string;
  brokers: string[];
  username: string;
  password: string;
  groupId: string;
  logger: Logger;
  handler: EvaluationHandler;
  ssl?: boolean;
}

/**
 * Consumer statistics
 */
interface ConsumerStats {
  processedCount: number;
  errorCount: number;
  lastProcessedAt: Date | null;
  isRunning: boolean;
}

/**
 * EvaluationConsumer class
 *
 * AC-1: Creates a single KafkaConsumer instance (one topic only)
 * AC-2: Subscribes to evaluation.completed topic
 * AC-11: Graceful shutdown via stop()
 */
export class EvaluationConsumer {
  private consumer: KafkaConsumer;
  private handler: EvaluationHandler;
  private logger: Logger;
  private started: boolean = false;

  // Stats tracking
  private stats: ConsumerStats = {
    processedCount: 0,
    errorCount: 0,
    lastProcessedAt: null,
    isRunning: false,
  };

  constructor(config: EvaluationConsumerConfig) {
    this.handler = config.handler;
    this.logger = config.logger;

    // AC-1: Create KafkaConsumer instance
    this.consumer = new KafkaConsumer({
      serviceName: config.serviceName,
      brokers: config.brokers,
      username: config.username,
      password: config.password,
      groupId: config.groupId,
      logger: config.logger,
      ssl: config.ssl,
    });
  }

  /**
   * Start the evaluation consumer
   * AC-2: Subscribe to evaluation.completed topic
   */
  async start(): Promise<void> {
    this.logger.info('Connecting to Kafka', {
      serviceName: 'whatsapp-handler',
    });

    try {
      // Connect to Kafka
      await this.consumer.connect();

      this.logger.info('Successfully connected to Kafka', {
        serviceName: 'whatsapp-handler',
      });

      // AC-2: Subscribe to evaluation.completed topic
      this.logger.info('Subscribing to topic', { topic: 'evaluation.completed' });
      await this.consumer.subscribe('evaluation.completed', async (message) => {
        try {
          // Parse the Kafka message value
          if (!message.message.value) {
            this.logger.error('Empty message value received', {
              topic: message.topic,
              offset: message.message.offset,
            });
            return;
          }

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(message.message.value.toString());
          } catch (parseError) {
            this.logger.error('Failed to parse message payload', {
              error: parseError instanceof Error ? parseError.message : String(parseError),
              topic: message.topic,
              offset: message.message.offset,
            });
            return;
          }

          // Call the handler with parsed payload
          await this.handler(payload);
          this.stats.processedCount++;
          this.stats.lastProcessedAt = new Date();
        } catch (error) {
          this.stats.errorCount++;
          this.logger.error('Error processing evaluation.completed message', {
            error: error instanceof Error ? error.message : String(error),
            topic: message.topic,
            offset: message.message.offset,
          });
        }
      });

      // @railrepay/kafka-client v2.0.0: subscribe() only registers the topic;
      // start() must be called to begin consuming messages via KafkaJS run()
      await this.consumer.start();

      this.started = true;
      this.stats.isRunning = true;
    } catch (error) {
      this.logger.error('Failed to connect to Kafka', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the evaluation consumer
   * AC-11: Graceful shutdown disconnects Kafka consumer
   */
  async stop(): Promise<void> {
    const isConsumerRunning = this.consumer.isConsumerRunning();

    if (!this.started && !isConsumerRunning) {
      this.logger.warn('Consumer not running, nothing to stop', {
        serviceName: 'whatsapp-handler',
      });
      return;
    }

    this.logger.info('Shutting down Kafka consumer', {
      serviceName: 'whatsapp-handler',
    });

    try {
      await this.consumer.disconnect();

      this.started = false;
      this.stats.isRunning = false;

      this.logger.info('Successfully disconnected from Kafka', {
        serviceName: 'whatsapp-handler',
      });
    } catch (error) {
      this.logger.error('Error during Kafka consumer shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.started = false;
      this.stats.isRunning = false;
      // Don't throw - graceful shutdown should not fail
    }
  }

  /**
   * Get consumer statistics
   */
  getStats(): ConsumerStats {
    const isConsumerRunning = this.consumer.isConsumerRunning();
    this.stats.isRunning = this.started && isConsumerRunning;

    return { ...this.stats };
  }

  /**
   * Check if consumer is running
   */
  isRunning(): boolean {
    if (!this.started) {
      return false;
    }
    return this.consumer.isConsumerRunning();
  }
}
