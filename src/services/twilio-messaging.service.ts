/**
 * Twilio Messaging Service
 *
 * BL-148: Proactive WhatsApp messaging via Twilio REST API.
 * Distinct from TwilioVerifyService (which handles OTP verification).
 *
 * AC-4: Send eligible evaluation notifications
 * AC-5: Send ineligible evaluation notifications
 * AC-6: Uses Twilio REST API client.messages.create() (NOT TwiML)
 *
 * Per ADR-014: TDD implementation (tests written first by Jessie)
 */

import Twilio from 'twilio';

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
 * Twilio messaging configuration
 */
export interface TwilioMessagingConfig {
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
}

/**
 * Send result
 */
export interface SendResult {
  sid: string;
  status: string;
}

/**
 * TwilioMessagingService
 *
 * Sends proactive WhatsApp messages via Twilio REST API.
 * AC-6: Uses client.messages.create() for outbound messages.
 */
export class TwilioMessagingService {
  private client: ReturnType<typeof Twilio>;
  private whatsappNumber: string;
  private logger: Logger;

  constructor(config: TwilioMessagingConfig, logger: Logger) {
    if (!config.accountSid || config.accountSid.trim() === '') {
      throw new Error('TWILIO_ACCOUNT_SID is required');
    }
    if (!config.authToken || config.authToken.trim() === '') {
      throw new Error('TWILIO_AUTH_TOKEN is required');
    }
    if (!config.whatsappNumber || config.whatsappNumber.trim() === '') {
      throw new Error('TWILIO_WHATSAPP_NUMBER is required');
    }

    this.client = Twilio(config.accountSid, config.authToken);
    this.whatsappNumber = config.whatsappNumber;
    this.logger = logger;
  }

  /**
   * Send a proactive WhatsApp message
   *
   * AC-6: Uses client.messages.create() with whatsapp: prefix
   *
   * @param phoneNumber - E.164 format phone number (e.g., +447700900123)
   * @param body - Message body text
   * @returns SendResult with message SID and status
   */
  async sendWhatsAppMessage(phoneNumber: string, body: string): Promise<SendResult> {
    if (!phoneNumber || phoneNumber.trim() === '') {
      throw new Error('Phone number is required');
    }
    if (!body || body.trim() === '') {
      throw new Error('Message body is required');
    }

    this.logger.info('Sending proactive WhatsApp message', {
      to: phoneNumber,
    });

    const message = await this.client.messages.create({
      from: this.whatsappNumber,
      to: `whatsapp:${phoneNumber}`,
      body,
    });

    this.logger.info('WhatsApp message sent successfully', {
      messageSid: message.sid,
      to: phoneNumber,
      status: message.status,
    });

    return {
      sid: message.sid,
      status: message.status,
    };
  }
}
