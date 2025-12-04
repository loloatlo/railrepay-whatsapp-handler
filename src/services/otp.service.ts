/**
 * OTPService - One-Time Password generation and verification
 * Per specification §5.2: OTP verification flow
 *
 * Security requirements:
 * - 6-digit numeric code
 * - SHA256 hashing for storage
 * - 5-minute expiry
 * - 3 attempts max (enforced by caller)
 */

import { createHash, randomInt } from 'crypto';

/**
 * Result of OTP generation with both plain and hashed values
 */
export interface OTPGenerationResult {
  plain: string; // Send to user via SMS
  hashed: string; // Store in database
}

/**
 * OTP Service for secure one-time password operations
 *
 * @example
 * ```typescript
 * const otpService = new OTPService();
 *
 * // Generate and hash OTP
 * const { plain, hashed } = otpService.generateAndHash();
 * // Send `plain` to user via SMS
 * // Store `hashed` in database
 *
 * // Later, verify user input
 * const userInput = '123456';
 * const isValid = otpService.verify(userInput, hashedFromDB);
 *
 * // Check expiry
 * const createdAt = new Date(user.otp_created_at);
 * if (otpService.isExpired(createdAt)) {
 *   throw new Error('OTP expired');
 * }
 * ```
 */
export class OTPService {
  private readonly EXPIRY_MINUTES = 5;

  /**
   * Generate a random 6-digit OTP code
   *
   * @returns 6-digit numeric string (e.g., "123456")
   */
  generate(): string {
    // Generate random number between 100000 and 999999 (inclusive)
    const otp = randomInt(100000, 1000000);
    return otp.toString();
  }

  /**
   * Hash an OTP using SHA256
   * Per specification: Use crypto.createHash('sha256')
   *
   * @param plainOTP - Plain text OTP (6 digits)
   * @returns SHA256 hash as hex string (64 characters)
   */
  hash(plainOTP: string): string {
    return createHash('sha256').update(plainOTP).digest('hex');
  }

  /**
   * Verify an OTP against its hashed value
   *
   * @param plainOTP - User input (6 digits)
   * @param hashedOTP - Stored hash from database
   * @returns true if OTP matches, false otherwise
   */
  verify(plainOTP: string, hashedOTP: string): boolean {
    if (!hashedOTP) {
      return false;
    }

    const inputHash = this.hash(plainOTP);
    return inputHash === hashedOTP;
  }

  /**
   * Check if OTP has expired
   * Per specification: 5-minute expiry
   *
   * @param createdAt - Timestamp when OTP was created
   * @returns true if expired, false if still valid
   */
  isExpired(createdAt: Date): boolean {
    const now = new Date();
    const expiryTime = new Date(createdAt.getTime() + this.EXPIRY_MINUTES * 60 * 1000);
    return now >= expiryTime;
  }

  /**
   * Generate OTP and return both plain and hashed versions
   * Convenience method for creating new OTPs
   *
   * @returns Object with plain and hashed OTP
   */
  generateAndHash(): OTPGenerationResult {
    const plain = this.generate();
    const hashed = this.hash(plain);
    return { plain, hashed };
  }
}
