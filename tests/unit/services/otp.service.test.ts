/**
 * Unit tests for OTPService
 * Tests FIRST (TDD per ADR-014)
 *
 * Per specification §5.2: OTP generation, hashing, verification
 * Security: 6-digit code, hashed storage, 5-minute expiry, 3 attempts max
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

describe('OTPService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generate', () => {
    it('should generate a 6-digit OTP code', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();

      // Act
      const otp = otpService.generate();

      // Assert
      expect(otp).toMatch(/^\d{6}$/); // Exactly 6 digits
      expect(parseInt(otp, 10)).toBeGreaterThanOrEqual(100000);
      expect(parseInt(otp, 10)).toBeLessThanOrEqual(999999);
    });

    it('should generate unique OTP codes on subsequent calls', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();

      // Act
      const otp1 = otpService.generate();
      const otp2 = otpService.generate();
      const otp3 = otpService.generate();

      // Assert
      // While technically possible to have duplicates, highly unlikely
      const uniqueOTPs = new Set([otp1, otp2, otp3]);
      expect(uniqueOTPs.size).toBeGreaterThan(1); // At least 2 unique
    });
  });

  describe('hash', () => {
    it('should hash OTP using SHA256', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();
      const plainOTP = '123456';

      // Act
      const hashed = otpService.hash(plainOTP);

      // Assert
      // SHA256 produces 64-character hex string
      expect(hashed).toHaveLength(64);
      expect(hashed).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce consistent hash for same OTP', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();
      const plainOTP = '123456';

      // Act
      const hash1 = otpService.hash(plainOTP);
      const hash2 = otpService.hash(plainOTP);

      // Assert
      expect(hash1).toBe(hash2); // Deterministic hashing
    });

    it('should produce different hashes for different OTPs', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();

      // Act
      const hash1 = otpService.hash('123456');
      const hash2 = otpService.hash('654321');

      // Assert
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verify', () => {
    it('should return true when OTP matches hashed value', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();
      const plainOTP = '123456';
      const hashedOTP = otpService.hash(plainOTP);

      // Act
      const isValid = otpService.verify(plainOTP, hashedOTP);

      // Assert
      expect(isValid).toBe(true);
    });

    it('should return false when OTP does not match hashed value', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();
      const correctOTP = '123456';
      const incorrectOTP = '654321';
      const hashedOTP = otpService.hash(correctOTP);

      // Act
      const isValid = otpService.verify(incorrectOTP, hashedOTP);

      // Assert
      expect(isValid).toBe(false);
    });

    it('should return false for null or empty hashed OTP', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();

      // Act & Assert
      expect(otpService.verify('123456', null as any)).toBe(false);
      expect(otpService.verify('123456', '')).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('should return false for OTP created less than 5 minutes ago', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();
      const createdAt = new Date(Date.now() - 4 * 60 * 1000); // 4 minutes ago

      // Act
      const expired = otpService.isExpired(createdAt);

      // Assert
      expect(expired).toBe(false);
    });

    it('should return true for OTP created more than 5 minutes ago', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();
      const createdAt = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago

      // Act
      const expired = otpService.isExpired(createdAt);

      // Assert
      expect(expired).toBe(true);
    });

    it('should return true for OTP created exactly 5 minutes ago', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();
      const createdAt = new Date(Date.now() - 5 * 60 * 1000); // Exactly 5 minutes ago

      // Act
      const expired = otpService.isExpired(createdAt);

      // Assert
      expect(expired).toBe(true); // Inclusive boundary
    });
  });

  describe('generateAndHash', () => {
    it('should generate OTP and return both plain and hashed versions', async () => {
      // Arrange
      const { OTPService } = await import('../../../src/services/otp.service.js');
      const otpService = new OTPService();

      // Act
      const result = otpService.generateAndHash();

      // Assert
      expect(result.plain).toMatch(/^\d{6}$/);
      expect(result.hashed).toHaveLength(64);
      expect(result.hashed).toMatch(/^[a-f0-9]{64}$/);
      // Verify hash matches plain
      expect(otpService.verify(result.plain, result.hashed)).toBe(true);
    });
  });
});
