/**
 * Twilio Verify Service Unit Tests
 *
 * TDD Phase: FAILING TESTS FIRST
 * Following ADR-014 testing strategy
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TwilioVerifyService } from '../../../src/services/twilio-verify.service';

// Mock Twilio SDK - must be inline to avoid hoisting issues
vi.mock('twilio', () => {
  const mockVerificationsCreate = vi.fn();
  const mockVerificationChecksCreate = vi.fn();
  const mockServices = vi.fn(() => ({
    verifications: {
      create: mockVerificationsCreate,
    },
    verificationChecks: {
      create: mockVerificationChecksCreate,
    },
  }));

  const mockTwilioConstructor = vi.fn(() => ({
    verify: {
      v2: {
        services: mockServices,
      },
    },
  }));

  // Export the mocks for test access
  (mockTwilioConstructor as any).mockVerificationsCreate = mockVerificationsCreate;
  (mockTwilioConstructor as any).mockVerificationChecksCreate = mockVerificationChecksCreate;
  (mockTwilioConstructor as any).mockServices = mockServices;

  return {
    default: mockTwilioConstructor,
  };
});

describe('TwilioVerifyService', () => {
  let service: TwilioVerifyService;
  let mockVerificationsCreate: any;
  let mockVerificationChecksCreate: any;
  let mockServices: any;

  const validConfig = {
    accountSid: 'ACtest1234567890',
    authToken: 'test_auth_token',
    verifyServiceSid: 'VAtest1234567890',
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get mocks from the Twilio constructor
    const Twilio = (await import('twilio')).default as any;
    mockVerificationsCreate = Twilio.mockVerificationsCreate;
    mockVerificationChecksCreate = Twilio.mockVerificationChecksCreate;
    mockServices = Twilio.mockServices;

    service = new TwilioVerifyService(
      validConfig.accountSid,
      validConfig.authToken,
      validConfig.verifyServiceSid
    );
  });

  describe('constructor', () => {
    it('should create instance with valid configuration', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(TwilioVerifyService);
    });

    it('should throw error if accountSid is missing', () => {
      expect(() => {
        new TwilioVerifyService('', validConfig.authToken, validConfig.verifyServiceSid);
      }).toThrow('TWILIO_ACCOUNT_SID is required');
    });

    it('should throw error if authToken is missing', () => {
      expect(() => {
        new TwilioVerifyService(validConfig.accountSid, '', validConfig.verifyServiceSid);
      }).toThrow('TWILIO_AUTH_TOKEN is required');
    });

    it('should throw error if verifyServiceSid is missing', () => {
      expect(() => {
        new TwilioVerifyService(validConfig.accountSid, validConfig.authToken, '');
      }).toThrow('TWILIO_VERIFY_SERVICE_SID is required');
    });
  });

  describe('startVerification', () => {
    it('should successfully start verification for valid phone number', async () => {
      const phoneNumber = '+447700900000';
      const mockResponse = {
        sid: 'VEtest1234567890',
        status: 'pending',
        to: phoneNumber,
        channel: 'sms',
        valid: false,
      };

      mockVerificationsCreate.mockResolvedValue(mockResponse);

      const result = await service.startVerification(phoneNumber);

      expect(result).toEqual({
        sid: 'VEtest1234567890',
        status: 'pending',
      });

      expect(mockServices).toHaveBeenCalledWith(validConfig.verifyServiceSid);
      expect(mockVerificationsCreate).toHaveBeenCalledWith({
        to: phoneNumber,
        channel: 'sms',
      });
    });

    it('should throw error for invalid phone number format', async () => {
      const invalidPhone = 'not-a-phone';

      await expect(service.startVerification(invalidPhone)).rejects.toThrow('Invalid phone number format');
    });

    it('should throw error for empty phone number', async () => {
      await expect(service.startVerification('')).rejects.toThrow('Phone number is required');
    });

    it('should handle Twilio API errors gracefully', async () => {
      const phoneNumber = '+447700900000';
      const twilioError = new Error('Twilio API Error: Rate limit exceeded');
      (twilioError as any).code = 20429;

      mockVerificationsCreate.mockRejectedValue(twilioError);

      await expect(service.startVerification(phoneNumber)).rejects.toThrow('Failed to start verification: Twilio API Error: Rate limit exceeded');
    });

    it('should handle network errors', async () => {
      const phoneNumber = '+447700900000';
      const networkError = new Error('Network timeout');

      mockVerificationsCreate.mockRejectedValue(networkError);

      await expect(service.startVerification(phoneNumber)).rejects.toThrow('Failed to start verification: Network timeout');
    });

    it('should validate E.164 phone number format', async () => {
      // Valid E.164 formats should pass
      const validPhones = ['+447700900000', '+1234567890', '+4407700900000'];

      for (const phone of validPhones) {
        mockVerificationsCreate.mockResolvedValue({
          sid: 'VEtest',
          status: 'pending',
        });

        await expect(service.startVerification(phone)).resolves.toBeDefined();
      }

      // Invalid formats should fail
      const invalidPhones = ['447700900000', '07700900000', 'invalid'];

      for (const phone of invalidPhones) {
        await expect(service.startVerification(phone)).rejects.toThrow();
      }
    });
  });

  describe('checkVerification', () => {
    it('should return valid: true for correct verification code', async () => {
      const phoneNumber = '+447700900000';
      const code = '123456';
      const mockResponse = {
        sid: 'VEtest1234567890',
        status: 'approved',
        valid: true,
        to: phoneNumber,
      };

      mockVerificationChecksCreate.mockResolvedValue(mockResponse);

      const result = await service.checkVerification(phoneNumber, code);

      expect(result).toEqual({
        valid: true,
        status: 'approved',
      });

      expect(mockServices).toHaveBeenCalledWith(validConfig.verifyServiceSid);
      expect(mockVerificationChecksCreate).toHaveBeenCalledWith({
        to: phoneNumber,
        code: code,
      });
    });

    it('should return valid: false for incorrect verification code', async () => {
      const phoneNumber = '+447700900000';
      const wrongCode = '000000';
      const mockResponse = {
        sid: 'VEtest1234567890',
        status: 'pending',
        valid: false,
        to: phoneNumber,
      };

      mockVerificationChecksCreate.mockResolvedValue(mockResponse);

      const result = await service.checkVerification(phoneNumber, wrongCode);

      expect(result).toEqual({
        valid: false,
        status: 'pending',
      });
    });

    it('should return valid: false for expired verification code', async () => {
      const phoneNumber = '+447700900000';
      const code = '123456';
      const mockResponse = {
        sid: 'VEtest1234567890',
        status: 'expired',
        valid: false,
        to: phoneNumber,
      };

      mockVerificationChecksCreate.mockResolvedValue(mockResponse);

      const result = await service.checkVerification(phoneNumber, code);

      expect(result).toEqual({
        valid: false,
        status: 'expired',
      });
    });

    it('should throw error for empty phone number', async () => {
      await expect(service.checkVerification('', '123456')).rejects.toThrow('Phone number is required');
    });

    it('should throw error for empty code', async () => {
      await expect(service.checkVerification('+447700900000', '')).rejects.toThrow('Verification code is required');
    });

    it('should throw error for invalid code format', async () => {
      const invalidCodes = ['12', '123', '123456789', 'abcdef', '12-34'];

      for (const code of invalidCodes) {
        await expect(service.checkVerification('+447700900000', code)).rejects.toThrow('Verification code must be 4-8 digits');
      }
    });

    it('should accept valid code formats', async () => {
      const phoneNumber = '+447700900000';
      const validCodes = ['1234', '123456', '12345678'];

      for (const code of validCodes) {
        mockVerificationChecksCreate.mockResolvedValue({
          sid: 'VEtest',
          status: 'approved',
          valid: true,
        });

        await expect(service.checkVerification(phoneNumber, code)).resolves.toBeDefined();
      }
    });

    it('should handle Twilio API errors during verification check', async () => {
      const phoneNumber = '+447700900000';
      const code = '123456';
      const twilioError = new Error('Verification check failed');
      (twilioError as any).code = 60200;

      mockVerificationChecksCreate.mockRejectedValue(twilioError);

      await expect(service.checkVerification(phoneNumber, code)).rejects.toThrow('Failed to check verification: Verification check failed');
    });

    it('should handle max check attempts exceeded', async () => {
      const phoneNumber = '+447700900000';
      const code = '123456';
      const mockResponse = {
        sid: 'VEtest1234567890',
        status: 'max_attempts_reached',
        valid: false,
        to: phoneNumber,
      };

      mockVerificationChecksCreate.mockResolvedValue(mockResponse);

      const result = await service.checkVerification(phoneNumber, code);

      expect(result).toEqual({
        valid: false,
        status: 'max_attempts_reached',
      });
    });
  });

  describe('error handling edge cases', () => {
    it('should handle Twilio client initialization failures', () => {
      const badConfig = {
        accountSid: 'invalid',
        authToken: 'invalid',
        verifyServiceSid: 'invalid',
      };

      // Should not throw during construction, but will fail on API calls
      expect(() => {
        new TwilioVerifyService(badConfig.accountSid, badConfig.authToken, badConfig.verifyServiceSid);
      }).not.toThrow();
    });

    it('should handle malformed Twilio API responses', async () => {
      const phoneNumber = '+447700900000';
      const malformedResponse = { unexpected: 'response' };

      mockVerificationsCreate.mockResolvedValue(malformedResponse);

      await expect(service.startVerification(phoneNumber)).rejects.toThrow();
    });
  });
});
