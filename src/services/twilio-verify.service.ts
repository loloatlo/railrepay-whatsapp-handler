/**
 * Twilio Verify Service
 *
 * Handles phone number verification using Twilio Verify API
 * TDD implementation per ADR-014
 */

import Twilio from 'twilio';

export interface VerificationResult {
  sid: string;
  status: string;
}

export interface VerificationCheckResult {
  valid: boolean;
  status: string;
}

export class TwilioVerifyService {
  private client: ReturnType<typeof Twilio>;
  private verifyServiceSid: string;

  constructor(accountSid: string, authToken: string, verifyServiceSid: string) {
    // Validate configuration
    if (!accountSid || accountSid.trim() === '') {
      throw new Error('TWILIO_ACCOUNT_SID is required');
    }
    if (!authToken || authToken.trim() === '') {
      throw new Error('TWILIO_AUTH_TOKEN is required');
    }
    if (!verifyServiceSid || verifyServiceSid.trim() === '') {
      throw new Error('TWILIO_VERIFY_SERVICE_SID is required');
    }

    this.client = Twilio(accountSid, authToken);
    this.verifyServiceSid = verifyServiceSid;
  }

  /**
   * Start phone number verification
   * Sends SMS with verification code
   *
   * @param phoneNumber - E.164 formatted phone number (e.g., +447700900000)
   * @returns Verification SID and status
   * @throws Error if phone number is invalid or Twilio API fails
   */
  async startVerification(phoneNumber: string): Promise<VerificationResult> {
    // Validate input
    if (!phoneNumber || phoneNumber.trim() === '') {
      throw new Error('Phone number is required');
    }

    // Validate E.164 format (starts with +, followed by 1-15 digits)
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    if (!e164Regex.test(phoneNumber)) {
      throw new Error('Invalid phone number format. Must be E.164 format (e.g., +447700900000)');
    }

    try {
      const verification = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verifications.create({
          to: phoneNumber,
          channel: 'sms',
        });

      // Validate response structure
      if (!verification.sid || !verification.status) {
        throw new Error('Invalid response from Twilio API');
      }

      return {
        sid: verification.sid,
        status: verification.status,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to start verification: ${error.message}`);
      }
      throw new Error('Failed to start verification: Unknown error');
    }
  }

  /**
   * Check verification code
   * Verifies user-provided code against pending verification
   *
   * @param phoneNumber - E.164 formatted phone number
   * @param code - Verification code (4-8 digits)
   * @returns Whether code is valid and verification status
   * @throws Error if inputs are invalid or Twilio API fails
   */
  async checkVerification(phoneNumber: string, code: string): Promise<VerificationCheckResult> {
    // Validate inputs
    if (!phoneNumber || phoneNumber.trim() === '') {
      throw new Error('Phone number is required');
    }

    if (!code || code.trim() === '') {
      throw new Error('Verification code is required');
    }

    // Validate code format (4-8 digits)
    const codeRegex = /^\d{4,8}$/;
    if (!codeRegex.test(code)) {
      throw new Error('Verification code must be 4-8 digits');
    }

    try {
      const verificationCheck = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verificationChecks.create({
          to: phoneNumber,
          code: code,
        });

      return {
        valid: verificationCheck.valid === true,
        status: verificationCheck.status,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to check verification: ${error.message}`);
      }
      throw new Error('Failed to check verification: Unknown error');
    }
  }
}
