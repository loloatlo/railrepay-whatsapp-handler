/**
 * Terms Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.2 Terms Handler
 * Per ADR-014: These tests define the behavior
 *
 * Test cases:
 * 1. Input "YES" → Start Twilio Verify, send OTP_REQUEST prompt, transition to AWAITING_OTP
 * 2. Input "yes" (case insensitive) → Same as "YES"
 * 3. Input "TERMS" → Send terms URL, stay in AWAITING_TERMS
 * 4. Input "NO" → Send goodbye, delete state (no nextState)
 * 5. Invalid input → Send error with hint, stay in AWAITING_TERMS
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { termsHandler } from '../../../src/handlers/terms.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

describe('Terms Handler', () => {
  let mockContext: HandlerContext;

  beforeEach(() => {
    mockContext = {
      phoneNumber: '+447700900123',
      messageBody: 'YES',
      messageSid: 'SM123',
      user: null,
      currentState: FSMState.AWAITING_TERMS,
      correlationId: 'test-corr-id',
    };
  });

  describe('User accepts terms (YES)', () => {
    it('should accept "YES" (uppercase)', async () => {
      // Arrange
      mockContext.messageBody = 'YES';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.response).toContain('verification code');
      expect(result.nextState).toBe(FSMState.AWAITING_OTP);
    });

    it('should accept "yes" (lowercase)', async () => {
      // Arrange
      mockContext.messageBody = 'yes';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.response).toContain('verification code');
      expect(result.nextState).toBe(FSMState.AWAITING_OTP);
    });

    it('should accept "Yes" (mixed case)', async () => {
      // Arrange
      mockContext.messageBody = 'Yes';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.nextState).toBe(FSMState.AWAITING_OTP);
    });

    it('should include state data with verification instruction', async () => {
      // Arrange
      mockContext.messageBody = 'YES';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      // stateData should indicate verification was started
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.verificationStarted).toBe(true);
    });

    it('should prompt user to check their phone for OTP', async () => {
      // Arrange
      mockContext.messageBody = 'YES';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.response).toContain('sent');
      expect(result.response).toContain('code');
    });
  });

  describe('User requests terms (TERMS)', () => {
    it('should send terms URL when user types TERMS', async () => {
      // Arrange
      mockContext.messageBody = 'TERMS';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.response).toContain('terms');
      expect(result.response).toContain('railrepay.co.uk');
    });

    it('should stay in AWAITING_TERMS after sending terms', async () => {
      // Arrange
      mockContext.messageBody = 'TERMS';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.nextState).toBe(FSMState.AWAITING_TERMS);
    });

    it('should accept "terms" (lowercase)', async () => {
      // Arrange
      mockContext.messageBody = 'terms';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.response).toContain('terms');
      expect(result.nextState).toBe(FSMState.AWAITING_TERMS);
    });
  });

  describe('User rejects terms (NO)', () => {
    it('should send goodbye message when user types NO', async () => {
      // Arrange
      mockContext.messageBody = 'NO';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.response).toContain('understand');
      expect(result.response).toContain('back');
    });

    it('should not transition to any state (conversation ends)', async () => {
      // Arrange
      mockContext.messageBody = 'NO';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      // No nextState means stay in current state, but caller should delete state
      expect(result.nextState).toBeUndefined();
    });

    it('should accept "no" (lowercase)', async () => {
      // Arrange
      mockContext.messageBody = 'no';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.response).toContain('understand');
      expect(result.nextState).toBeUndefined();
    });
  });

  describe('Invalid input', () => {
    it('should send error message for invalid input', async () => {
      // Arrange
      mockContext.messageBody = 'MAYBE';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.response).toContain('didn\'t understand');
    });

    it('should stay in AWAITING_TERMS for invalid input', async () => {
      // Arrange
      mockContext.messageBody = 'invalid';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.nextState).toBe(FSMState.AWAITING_TERMS);
    });

    it('should provide hint for valid options', async () => {
      // Arrange
      mockContext.messageBody = 'xyz';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.response).toContain('YES');
      expect(result.response).toContain('NO');
      expect(result.response).toContain('TERMS');
    });

    it('should handle empty input', async () => {
      // Arrange
      mockContext.messageBody = '';

      // Act
      const result = await termsHandler(mockContext);

      // Assert
      expect(result.response).toContain('didn\'t understand');
      expect(result.nextState).toBe(FSMState.AWAITING_TERMS);
    });
  });
});
