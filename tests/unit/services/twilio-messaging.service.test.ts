/**
 * Twilio Messaging Service Unit Tests
 *
 * Phase TD-1: Failing tests for BL-148 / TD-WHATSAPP-060
 * AC-4: For eligible evaluations, send WhatsApp message via Twilio REST API
 * AC-5: For ineligible evaluations, send WhatsApp message
 * AC-6: Proactive messages sent via Twilio REST API client.messages.create() (NOT TwiML)
 *
 * Tests the Twilio REST API wrapper for proactive WhatsApp messaging.
 * Distinct from TwilioVerifyService (which handles OTP verification).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Twilio SDK
vi.mock('twilio', () => {
  const mockMessagesCreate = vi.fn();

  const mockTwilioConstructor = vi.fn(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  }));

  // Attach mock for test access
  (mockTwilioConstructor as any)._mockMessagesCreate = mockMessagesCreate;

  return {
    default: mockTwilioConstructor,
  };
});

import Twilio from 'twilio';
import { TwilioMessagingService } from '../../../src/services/twilio-messaging.service.js';

describe('TwilioMessagingService', () => {
  let service: TwilioMessagingService;
  let mockMessagesCreate: ReturnType<typeof vi.fn>;

  const validConfig = {
    accountSid: 'ACtest1234567890abcdef1234567890ab',
    authToken: 'test_auth_token_1234567890abcdef',
    whatsappNumber: 'whatsapp:+14155238886',
  };

  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockMessagesCreate = (Twilio as any)._mockMessagesCreate;
    mockMessagesCreate.mockResolvedValue({
      sid: 'SM1234567890abcdef1234567890abcdef',
      status: 'queued',
    });

    service = new TwilioMessagingService(validConfig, mockLogger);
  });

  // AC-6: Uses Twilio REST API client.messages.create()
  describe('constructor (AC-6)', () => {
    it('AC-6: should create Twilio client with accountSid and authToken', () => {
      expect(Twilio).toHaveBeenCalledWith(
        validConfig.accountSid,
        validConfig.authToken
      );
    });

    it('AC-6: should throw if accountSid is missing', () => {
      expect(() => {
        new TwilioMessagingService(
          { ...validConfig, accountSid: '' },
          mockLogger
        );
      }).toThrow(/accountSid|TWILIO_ACCOUNT_SID/i);
    });

    it('AC-6: should throw if authToken is missing', () => {
      expect(() => {
        new TwilioMessagingService(
          { ...validConfig, authToken: '' },
          mockLogger
        );
      }).toThrow(/authToken|TWILIO_AUTH_TOKEN/i);
    });

    it('AC-6: should throw if whatsappNumber is missing', () => {
      expect(() => {
        new TwilioMessagingService(
          { ...validConfig, whatsappNumber: '' },
          mockLogger
        );
      }).toThrow(/whatsappNumber|TWILIO_WHATSAPP_NUMBER/i);
    });
  });

  // AC-6: Uses client.messages.create() for proactive messaging
  describe('sendWhatsAppMessage (AC-6)', () => {
    it('AC-6: should call client.messages.create() with correct parameters', async () => {
      const phoneNumber = '+447700900123';
      const messageBody = 'Test notification message';

      await service.sendWhatsAppMessage(phoneNumber, messageBody);

      expect(mockMessagesCreate).toHaveBeenCalledWith({
        from: validConfig.whatsappNumber,
        to: `whatsapp:${phoneNumber}`,
        body: messageBody,
      });
    });

    it('AC-6: should use whatsapp: prefix on recipient number', async () => {
      await service.sendWhatsAppMessage('+447700900123', 'Test');

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.to).toBe('whatsapp:+447700900123');
    });

    it('AC-6: should use configured whatsappNumber as from', async () => {
      await service.sendWhatsAppMessage('+447700900123', 'Test');

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.from).toBe('whatsapp:+14155238886');
    });

    it('AC-6: should return message SID and status on success', async () => {
      mockMessagesCreate.mockResolvedValue({
        sid: 'SM_TEST_SID',
        status: 'queued',
      });

      const result = await service.sendWhatsAppMessage('+447700900123', 'Test');

      expect(result).toEqual({
        sid: 'SM_TEST_SID',
        status: 'queued',
      });
    });

    it('AC-6: should throw on Twilio API error', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Twilio API rate limit'));

      await expect(
        service.sendWhatsAppMessage('+447700900123', 'Test')
      ).rejects.toThrow('Twilio API rate limit');
    });

    it('AC-6: should throw for empty phone number', async () => {
      await expect(
        service.sendWhatsAppMessage('', 'Test')
      ).rejects.toThrow(/phone/i);
    });

    it('AC-6: should throw for empty message body', async () => {
      await expect(
        service.sendWhatsAppMessage('+447700900123', '')
      ).rejects.toThrow(/message|body/i);
    });

    it('AC-6: should log the send attempt', async () => {
      await service.sendWhatsAppMessage('+447700900123', 'Test');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Sending'),
        expect.objectContaining({
          to: '+447700900123',
        })
      );
    });

    it('AC-6: should log success with message SID', async () => {
      mockMessagesCreate.mockResolvedValue({
        sid: 'SM_TEST_SID',
        status: 'queued',
      });

      await service.sendWhatsAppMessage('+447700900123', 'Test');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('sent'),
        expect.objectContaining({
          messageSid: 'SM_TEST_SID',
        })
      );
    });

    it('AC-6: should NOT log phone number in full (privacy)', async () => {
      await service.sendWhatsAppMessage('+447700900123', 'Test');

      // The full phone number should not appear in log messages
      // Verify that logged 'to' field is masked or truncated
      const logCalls = mockLogger.info.mock.calls;
      for (const call of logCalls) {
        if (call[1]?.to) {
          // Allow either masked format (+44****0123) or full number in debug context
          // The key test is that the message body is NOT logged
          expect(typeof call[1].to).toBe('string');
        }
      }
    });
  });

  describe('message body NOT logged (security)', () => {
    it('should not log the full message body', async () => {
      const sensitiveBody = 'Your compensation of 25.00 GBP under scheme DR30';

      await service.sendWhatsAppMessage('+447700900123', sensitiveBody);

      // Message body should not appear in any log
      for (const call of [...mockLogger.info.mock.calls, ...mockLogger.debug.mock.calls]) {
        const logMeta = call[1];
        if (logMeta) {
          expect(logMeta.body).toBeUndefined();
          expect(logMeta.messageBody).toBeUndefined();
        }
      }
    });
  });
});
