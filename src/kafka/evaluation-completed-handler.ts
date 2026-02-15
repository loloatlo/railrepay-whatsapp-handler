/**
 * Evaluation Completed Event Handler
 *
 * BL-148 (TD-WHATSAPP-060): Kafka consumer handler for evaluation.completed events
 * from evaluation-coordinator via outbox-relay.
 *
 * AC-3: Look up user phone_number from whatsapp_handler.users by user_id
 * AC-4: For eligible evaluations, send WhatsApp message with compensation info
 * AC-5: For ineligible evaluations, send rejection message
 * AC-8: Idempotent processing -- duplicate events do not send duplicate notifications
 * AC-9: Uses @railrepay/winston-logger with correlation_id from event payload
 *
 * Per ADR-014: TDD implementation (tests written first by Jessie)
 * Per ADR-001: Schema-per-service -- only reads from whatsapp_handler.users
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Logger interface
 */
interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * User repository interface (reads from whatsapp_handler.users)
 */
interface UserRepository {
  findById(id: string): Promise<{ id: string; phone_number: string } | null>;
}

/**
 * Twilio messaging service interface
 */
interface TwilioMessaging {
  sendWhatsAppMessage(phoneNumber: string, body: string): Promise<{ sid: string; status: string }>;
}

/**
 * Idempotency store interface
 * Tracks processed correlation_ids to prevent duplicate notifications
 */
interface IdempotencyStore {
  hasProcessed(correlationId: string): Promise<boolean>;
  markProcessed(correlationId: string): Promise<void>;
}

/**
 * Metrics interface
 * Compatible with prom-client Counter type
 */
interface Metrics {
  notificationsSent: { inc: (labels?: any, value?: number) => void };
  notificationErrors: { inc: (labels?: any, value?: number) => void };
}

/**
 * Payload interface for evaluation.completed events
 */
export interface EvaluationCompletedPayload {
  journey_id: string;
  user_id: string;
  eligible: boolean;
  scheme: string;
  compensation_pence: number;
  delay_minutes: number; // BL-151 AC-7: delay duration for user-friendly messages
  correlation_id?: string;
}

/**
 * Handler dependencies
 */
interface EvaluationCompletedHandlerDeps {
  userRepository: UserRepository;
  twilioMessaging: TwilioMessaging;
  idempotencyStore: IdempotencyStore;
  logger: Logger;
  metrics: Metrics;
}

/**
 * Format pence as GBP string (e.g., 2500 -> "25.00")
 */
function formatPenceAsGBP(pence: number): string {
  const pounds = pence / 100;
  return pounds.toFixed(2);
}

/**
 * EvaluationCompletedHandler
 *
 * Processes evaluation.completed Kafka events and sends proactive
 * WhatsApp notifications to users.
 */
export class EvaluationCompletedHandler {
  readonly topic = 'evaluation.completed';

  private userRepository: UserRepository;
  private twilioMessaging: TwilioMessaging;
  private idempotencyStore: IdempotencyStore;
  private logger: Logger;
  private metrics: Metrics;

  constructor(deps: EvaluationCompletedHandlerDeps) {
    this.userRepository = deps.userRepository;
    this.twilioMessaging = deps.twilioMessaging;
    this.idempotencyStore = deps.idempotencyStore;
    this.logger = deps.logger;
    this.metrics = deps.metrics;
  }

  /**
   * Handle incoming evaluation.completed event
   *
   * AC-3: Look up user by user_id
   * AC-4/AC-5: Send appropriate message
   * AC-8: Idempotent processing
   * AC-9: Log with correlation_id
   */
  async handle(payload: EvaluationCompletedPayload | Record<string, unknown>): Promise<void> {
    // Validate payload
    this.validatePayload(payload);

    const typedPayload = payload as EvaluationCompletedPayload;

    // AC-9: Extract or generate correlation_id
    let correlationId = typedPayload.correlation_id;
    if (!correlationId || correlationId.trim() === '') {
      correlationId = uuidv4();
      this.logger.warn('correlation_id missing from evaluation.completed payload, generated new UUID', {
        journey_id: typedPayload.journey_id,
        correlation_id: correlationId,
      });
    }

    // AC-8: Check idempotency
    const alreadyProcessed = await this.idempotencyStore.hasProcessed(correlationId);
    if (alreadyProcessed) {
      this.logger.info('Skipping duplicate evaluation.completed event', {
        correlation_id: correlationId,
        journey_id: typedPayload.journey_id,
      });
      return;
    }

    this.logger.info('Processing evaluation.completed event', {
      correlation_id: correlationId,
      journey_id: typedPayload.journey_id,
      user_id: typedPayload.user_id,
      eligible: typedPayload.eligible,
    });

    try {
      // AC-3: Look up user phone_number by user_id
      const user = await this.userRepository.findById(typedPayload.user_id);
      if (!user) {
        this.logger.error('User not found for evaluation notification', {
          user_id: typedPayload.user_id,
          correlation_id: correlationId,
          journey_id: typedPayload.journey_id,
        });
        this.metrics.notificationErrors.inc();
        return;
      }

      // AC-4/AC-5: Build message based on eligibility
      const messageBody = typedPayload.eligible
        ? this.buildEligibleMessage(typedPayload)
        : this.buildIneligibleMessage(typedPayload);

      // AC-6: Send via Twilio REST API
      await this.twilioMessaging.sendWhatsAppMessage(user.phone_number, messageBody);

      // AC-8: Mark as processed after successful send
      await this.idempotencyStore.markProcessed(correlationId);

      // AC-10: Increment success counter
      const resultLabel = typedPayload.eligible ? 'eligible' : 'ineligible';
      this.metrics.notificationsSent.inc({ result: resultLabel });

      this.logger.info('Evaluation notification sent successfully', {
        correlation_id: correlationId,
        user_id: typedPayload.user_id,
        journey_id: typedPayload.journey_id,
        eligible: typedPayload.eligible,
      });
    } catch (error) {
      this.logger.error('Failed to send evaluation notification', {
        correlation_id: correlationId,
        journey_id: typedPayload.journey_id,
        user_id: typedPayload.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      this.metrics.notificationErrors.inc();
      // Do NOT mark as processed -- allow retry on next consumption
    }
  }

  /**
   * AC-4: Build eligible evaluation message
   * BL-151 AC-2: Include delay minutes
   * BL-151 AC-3: No scheme name
   * BL-151 AC-4: No false auto-process promise
   */
  private buildEligibleMessage(payload: EvaluationCompletedPayload): string {
    const compensationGBP = formatPenceAsGBP(payload.compensation_pence);
    return `Great news! Your train was delayed by ${payload.delay_minutes} minutes, and your journey is eligible for compensation.\n\nEstimated compensation: \u00a3${compensationGBP}\n\nWe'll be in touch with next steps.`;
  }

  /**
   * AC-5: Build ineligible evaluation message
   * BL-151 AC-5: No scheme name
   * BL-151 AC-6: Include delay minutes
   */
  private buildIneligibleMessage(payload: EvaluationCompletedPayload): string {
    return `We've completed the evaluation of your journey. Your train was delayed by ${payload.delay_minutes} minutes.\n\nUnfortunately, your journey does not qualify for compensation at this time.\n\nIf you have questions, reply to this message.`;
  }

  /**
   * Validate incoming payload
   */
  private validatePayload(payload: EvaluationCompletedPayload | Record<string, unknown>): void {
    if (!payload.journey_id) {
      throw new Error('Validation error: journey_id is required');
    }
    if (!payload.user_id) {
      throw new Error('Validation error: user_id is required');
    }
    if (payload.eligible === undefined || payload.eligible === null) {
      throw new Error('Validation error: eligible is required');
    }
    if (!payload.scheme) {
      throw new Error('Validation error: scheme is required');
    }
  }
}
