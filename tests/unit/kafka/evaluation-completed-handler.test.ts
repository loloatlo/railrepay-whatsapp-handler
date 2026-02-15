/**
 * Evaluation Completed Handler Unit Tests
 *
 * Phase TD-1: Failing tests for BL-148 / TD-WHATSAPP-060
 * Updated for BL-151 / TD-WHATSAPP-061: Improve notification messages
 *
 * BL-148 ACs (preserved):
 * AC-3: On receiving evaluation.completed event, look up user phone_number by user_id
 * AC-4: For eligible evaluations, send WhatsApp message with eligibility status, compensation (GBP)
 * AC-5: For ineligible evaluations, send WhatsApp message indicating not qualified
 * AC-8: Idempotent processing -- duplicate events do not send duplicate notifications
 * AC-9: Uses @railrepay/winston-logger with correlation_id from event payload
 *
 * BL-151 ACs (new):
 * AC-2: Eligible message includes delay minutes
 * AC-3: Eligible message does NOT include scheme name
 * AC-4: Eligible message does NOT include auto-process promise
 * AC-5: Ineligible message does NOT include scheme name
 * AC-6: Ineligible message includes delay minutes
 * AC-7: EvaluationCompletedPayload includes delay_minutes: number
 *
 * Pattern reference: evaluation-coordinator/src/kafka/delay-detected-handler.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationCompletedHandler } from '../../../src/kafka/evaluation-completed-handler.js';

describe('EvaluationCompletedHandler', () => {
  let handler: EvaluationCompletedHandler;

  const mockUserRepository = {
    findById: vi.fn(),
    findByPhone: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findAllVerified: vi.fn(),
  };

  const mockTwilioMessaging = {
    sendWhatsAppMessage: vi.fn(),
  };

  const mockIdempotencyStore = {
    hasProcessed: vi.fn(),
    markProcessed: vi.fn(),
  };

  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  const mockMetrics = {
    notificationsSent: { inc: vi.fn() },
    notificationErrors: { inc: vi.fn() },
  };

  const validEligiblePayload = {
    journey_id: '123e4567-e89b-12d3-a456-426614174000',
    user_id: '123e4567-e89b-12d3-a456-426614174001',
    eligible: true,
    scheme: 'DR30',
    compensation_pence: 2500,
    delay_minutes: 38, // BL-151 AC-7: delay_minutes in payload
    correlation_id: '123e4567-e89b-12d3-a456-426614174002',
  };

  const validIneligiblePayload = {
    journey_id: '223e4567-e89b-12d3-a456-426614174000',
    user_id: '123e4567-e89b-12d3-a456-426614174001',
    eligible: false,
    scheme: 'DR30',
    compensation_pence: 0,
    delay_minutes: 12, // BL-151 AC-7: delay_minutes in payload
    correlation_id: '223e4567-e89b-12d3-a456-426614174002',
  };

  const testUser = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    phone_number: '+447700900123',
    verified_at: new Date('2024-01-15'),
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-15'),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: user exists, not yet processed, Twilio succeeds
    mockUserRepository.findById.mockResolvedValue(testUser);
    mockIdempotencyStore.hasProcessed.mockResolvedValue(false);
    mockTwilioMessaging.sendWhatsAppMessage.mockResolvedValue({
      sid: 'SM1234567890',
      status: 'queued',
    });

    handler = new EvaluationCompletedHandler({
      userRepository: mockUserRepository,
      twilioMessaging: mockTwilioMessaging,
      idempotencyStore: mockIdempotencyStore,
      logger: mockLogger,
      metrics: mockMetrics,
    });
  });

  // AC-3: Look up user phone_number by user_id
  describe('user lookup (AC-3)', () => {
    it('AC-3: should look up user by user_id from event payload', async () => {
      await handler.handle(validEligiblePayload);

      expect(mockUserRepository.findById).toHaveBeenCalledWith(
        validEligiblePayload.user_id
      );
    });

    it('AC-3: should log error and not send message when user not found', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      await handler.handle(validEligiblePayload);

      expect(mockTwilioMessaging.sendWhatsAppMessage).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('User not found'),
        expect.objectContaining({
          user_id: validEligiblePayload.user_id,
          correlation_id: validEligiblePayload.correlation_id,
        })
      );
    });

    it('AC-3: should increment error counter when user not found', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      await handler.handle(validEligiblePayload);

      expect(mockMetrics.notificationErrors.inc).toHaveBeenCalled();
    });
  });

  // AC-4: Eligible evaluation sends compensation message
  describe('eligible evaluation message (AC-4)', () => {
    it('AC-4: should send WhatsApp message for eligible evaluation', async () => {
      await handler.handle(validEligiblePayload);

      expect(mockTwilioMessaging.sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    });

    it('AC-4: should send to user phone_number from DB lookup', async () => {
      await handler.handle(validEligiblePayload);

      expect(mockTwilioMessaging.sendWhatsAppMessage).toHaveBeenCalledWith(
        testUser.phone_number,
        expect.any(String)
      );
    });

    it('AC-4: should include eligibility status in message', async () => {
      await handler.handle(validEligiblePayload);

      const sentMessage = mockTwilioMessaging.sendWhatsAppMessage.mock.calls[0][1];
      expect(sentMessage).toMatch(/eligible/i);
    });

    it('AC-4: should include compensation amount formatted as GBP in message', async () => {
      await handler.handle(validEligiblePayload);

      const sentMessage = mockTwilioMessaging.sendWhatsAppMessage.mock.calls[0][1];
      // 2500 pence = 25.00 GBP
      expect(sentMessage).toContain('25.00');
    });

    it('AC-4: should format compensation_pence as pounds correctly', async () => {
      // Test various pence amounts
      const payloadWithOddPence = {
        ...validEligiblePayload,
        compensation_pence: 1550, // 15.50 GBP
      };

      await handler.handle(payloadWithOddPence);

      const sentMessage = mockTwilioMessaging.sendWhatsAppMessage.mock.calls[0][1];
      expect(sentMessage).toContain('15.50');
    });

    // BL-151 AC-3: Eligible message must NOT include scheme name (rail industry jargon)
    it('BL-151 AC-3: should NOT include scheme name in eligible message', async () => {
      await handler.handle(validEligiblePayload);

      const sentMessage = mockTwilioMessaging.sendWhatsAppMessage.mock.calls[0][1];
      expect(sentMessage).not.toContain('DR30');
      expect(sentMessage).not.toContain('DR15');
      expect(sentMessage).not.toContain('Delay Repay');
      expect(sentMessage).not.toMatch(/scheme/i);
    });

    it('AC-4: should increment notifications_sent counter with eligible label', async () => {
      await handler.handle(validEligiblePayload);

      expect(mockMetrics.notificationsSent.inc).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'eligible' })
      );
    });
  });

  // AC-5: Ineligible evaluation sends rejection message
  describe('ineligible evaluation message (AC-5)', () => {
    it('AC-5: should send WhatsApp message for ineligible evaluation', async () => {
      await handler.handle(validIneligiblePayload);

      expect(mockTwilioMessaging.sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    });

    it('AC-5: should indicate journey does not qualify for compensation', async () => {
      await handler.handle(validIneligiblePayload);

      const sentMessage = mockTwilioMessaging.sendWhatsAppMessage.mock.calls[0][1];
      expect(sentMessage).toMatch(/does not qualify|not eligible|ineligible/i);
    });

    // BL-151 AC-5: Ineligible message must NOT include scheme name (rail industry jargon)
    it('BL-151 AC-5: should NOT include scheme name in ineligible message', async () => {
      await handler.handle(validIneligiblePayload);

      const sentMessage = mockTwilioMessaging.sendWhatsAppMessage.mock.calls[0][1];
      expect(sentMessage).not.toContain('DR30');
      expect(sentMessage).not.toContain('DR15');
      expect(sentMessage).not.toContain('Delay Repay');
      expect(sentMessage).not.toMatch(/scheme/i);
    });

    it('AC-5: should increment notifications_sent counter with ineligible label', async () => {
      await handler.handle(validIneligiblePayload);

      expect(mockMetrics.notificationsSent.inc).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'ineligible' })
      );
    });
  });

  // BL-151: Improved notification messages
  describe('BL-151: improved notification messages', () => {
    // AC-2: Eligible message includes delay minutes
    it('BL-151 AC-2: eligible message should include delay minutes', async () => {
      await handler.handle(validEligiblePayload);

      const sentMessage = mockTwilioMessaging.sendWhatsAppMessage.mock.calls[0][1];
      // validEligiblePayload has delay_minutes: 38
      expect(sentMessage).toContain('38');
      expect(sentMessage).toMatch(/38 minutes/i);
    });

    // AC-4: Eligible message must NOT include false auto-process promise
    it('BL-151 AC-4: eligible message should NOT include auto-process promise', async () => {
      await handler.handle(validEligiblePayload);

      const sentMessage = mockTwilioMessaging.sendWhatsAppMessage.mock.calls[0][1];
      expect(sentMessage).not.toContain('process your claim automatically');
      expect(sentMessage).not.toContain('receive updates on the progress');
    });

    // AC-6: Ineligible message includes delay minutes
    it('BL-151 AC-6: ineligible message should include delay minutes', async () => {
      await handler.handle(validIneligiblePayload);

      const sentMessage = mockTwilioMessaging.sendWhatsAppMessage.mock.calls[0][1];
      // validIneligiblePayload has delay_minutes: 12
      expect(sentMessage).toContain('12');
      expect(sentMessage).toMatch(/12 minutes/i);
    });

    // AC-7: Payload with delay_minutes is accepted without error
    it('BL-151 AC-7: should process payload containing delay_minutes without error', async () => {
      const payloadWithDelayMinutes = {
        ...validEligiblePayload,
        delay_minutes: 45,
      };

      // Should not throw
      await handler.handle(payloadWithDelayMinutes);

      expect(mockTwilioMessaging.sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    });

    // AC-2: Delay minutes with different values in eligible message
    it('BL-151 AC-2: eligible message should include varied delay minutes correctly', async () => {
      const payloadWith120Min = {
        ...validEligiblePayload,
        delay_minutes: 120,
      };

      await handler.handle(payloadWith120Min);

      const sentMessage = mockTwilioMessaging.sendWhatsAppMessage.mock.calls[0][1];
      expect(sentMessage).toMatch(/120 minutes/i);
    });
  });

  // AC-8: Idempotent processing
  describe('idempotent processing (AC-8)', () => {
    it('AC-8: should check idempotency store before processing', async () => {
      await handler.handle(validEligiblePayload);

      expect(mockIdempotencyStore.hasProcessed).toHaveBeenCalledWith(
        validEligiblePayload.correlation_id
      );
    });

    it('AC-8: should skip processing if correlation_id already processed', async () => {
      mockIdempotencyStore.hasProcessed.mockResolvedValue(true);

      await handler.handle(validEligiblePayload);

      expect(mockUserRepository.findById).not.toHaveBeenCalled();
      expect(mockTwilioMessaging.sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('AC-8: should log skip message when duplicate detected', async () => {
      mockIdempotencyStore.hasProcessed.mockResolvedValue(true);

      await handler.handle(validEligiblePayload);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('duplicate'),
        expect.objectContaining({
          correlation_id: validEligiblePayload.correlation_id,
        })
      );
    });

    it('AC-8: should mark correlation_id as processed after successful send', async () => {
      await handler.handle(validEligiblePayload);

      expect(mockIdempotencyStore.markProcessed).toHaveBeenCalledWith(
        validEligiblePayload.correlation_id
      );
    });

    it('AC-8: should NOT mark as processed if Twilio send fails', async () => {
      mockTwilioMessaging.sendWhatsAppMessage.mockRejectedValue(
        new Error('Twilio API error')
      );

      await handler.handle(validEligiblePayload);

      expect(mockIdempotencyStore.markProcessed).not.toHaveBeenCalled();
    });
  });

  // AC-9: Uses winston-logger with correlation_id
  describe('logging with correlation_id (AC-9)', () => {
    it('AC-9: should log processing start with correlation_id', async () => {
      await handler.handle(validEligiblePayload);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Processing'),
        expect.objectContaining({
          correlation_id: validEligiblePayload.correlation_id,
          journey_id: validEligiblePayload.journey_id,
        })
      );
    });

    it('AC-9: should include correlation_id in all log messages', async () => {
      await handler.handle(validEligiblePayload);

      // Check all info calls include correlation_id
      for (const call of mockLogger.info.mock.calls) {
        if (call[1]) {
          expect(call[1]).toHaveProperty('correlation_id', validEligiblePayload.correlation_id);
        }
      }
    });

    it('AC-9: should generate correlation_id if missing from payload', async () => {
      const payloadWithoutCorrelationId = {
        journey_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        eligible: true,
        scheme: 'DR30',
        compensation_pence: 2500,
        // No correlation_id
      };

      await handler.handle(payloadWithoutCorrelationId);

      // Should still log with a generated correlation_id
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('correlation_id'),
        expect.objectContaining({
          journey_id: payloadWithoutCorrelationId.journey_id,
        })
      );
    });

    it('AC-9: should log success after message sent', async () => {
      await handler.handle(validEligiblePayload);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('notification sent'),
        expect.objectContaining({
          correlation_id: validEligiblePayload.correlation_id,
          user_id: validEligiblePayload.user_id,
        })
      );
    });
  });

  describe('payload validation', () => {
    it('should throw for missing journey_id', async () => {
      const invalidPayload = { ...validEligiblePayload, journey_id: undefined };

      await expect(handler.handle(invalidPayload as any)).rejects.toThrow(/journey_id/);
    });

    it('should throw for missing user_id', async () => {
      const invalidPayload = { ...validEligiblePayload, user_id: undefined };

      await expect(handler.handle(invalidPayload as any)).rejects.toThrow(/user_id/);
    });

    it('should throw for missing eligible field', async () => {
      const invalidPayload = { ...validEligiblePayload, eligible: undefined };

      await expect(handler.handle(invalidPayload as any)).rejects.toThrow(/eligible/);
    });

    it('should throw for missing scheme', async () => {
      const invalidPayload = { ...validEligiblePayload, scheme: undefined };

      await expect(handler.handle(invalidPayload as any)).rejects.toThrow(/scheme/);
    });
  });

  describe('error handling', () => {
    it('should handle Twilio send failure gracefully', async () => {
      mockTwilioMessaging.sendWhatsAppMessage.mockRejectedValue(
        new Error('Twilio rate limit')
      );

      // Should not throw -- handler should catch and log
      await handler.handle(validEligiblePayload);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send'),
        expect.objectContaining({
          correlation_id: validEligiblePayload.correlation_id,
          error: expect.stringContaining('rate limit'),
        })
      );
    });

    it('should increment error counter on Twilio failure', async () => {
      mockTwilioMessaging.sendWhatsAppMessage.mockRejectedValue(
        new Error('Twilio error')
      );

      await handler.handle(validEligiblePayload);

      expect(mockMetrics.notificationErrors.inc).toHaveBeenCalled();
    });

    it('should handle user repository errors gracefully', async () => {
      mockUserRepository.findById.mockRejectedValue(
        new Error('Database connection lost')
      );

      await handler.handle(validEligiblePayload);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed'),
        expect.objectContaining({
          correlation_id: validEligiblePayload.correlation_id,
        })
      );
    });
  });
});
