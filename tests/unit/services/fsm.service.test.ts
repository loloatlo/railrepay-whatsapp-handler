/**
 * Unit tests for FSM Service v2.0
 * Per ADR-014 (TDD): Tests written BEFORE implementation
 * Per ADR-004: Using Vitest test framework
 *
 * SPEC: Notion › RailRepay MVP › WhatsApp Message Flow
 * DESIGN: Finite State Machine for conversation flow with Redis state storage
 *
 * STATES (11 total):
 * 1. START - New user, no prior interaction
 * 2. AWAITING_TERMS - Terms sent, awaiting YES/NO
 * 3. AWAITING_OTP - OTP sent via Twilio Verify, awaiting code
 * 4. AUTHENTICATED - User verified, main menu
 * 5. AWAITING_JOURNEY_DATE - Awaiting journey date input
 * 6. AWAITING_JOURNEY_STATIONS - Awaiting FROM/TO stations
 * 7. AWAITING_JOURNEY_TIME - Awaiting journey time
 * 8. AWAITING_JOURNEY_CONFIRM - Journey summary shown, awaiting YES/NO
 * 9. AWAITING_TICKET_UPLOAD - Awaiting ticket photo
 * 10. AWAITING_CLAIM_STATUS - User requested status check
 * 11. ERROR - Invalid state or timeout (recovery state)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FsmService, FSMState } from '../../../src/services/fsm.service';
import type Redis from 'ioredis';

describe('FsmService v2.0', () => {
  let mockRedis: Redis;
  let fsmService: FsmService;

  const TEST_PHONE_NUMBER = '+447700900123';
  const TEST_STATE_KEY = 'fsm:state:+447700900123';

  beforeEach(() => {
    // Mock Redis client (ioredis)
    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as Redis;

    fsmService = new FsmService(mockRedis);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('FSMState enum', () => {
    it('should define all 11 states', () => {
      expect(FSMState.START).toBe('START');
      expect(FSMState.AWAITING_TERMS).toBe('AWAITING_TERMS');
      expect(FSMState.AWAITING_OTP).toBe('AWAITING_OTP');
      expect(FSMState.AUTHENTICATED).toBe('AUTHENTICATED');
      expect(FSMState.AWAITING_JOURNEY_DATE).toBe('AWAITING_JOURNEY_DATE');
      expect(FSMState.AWAITING_JOURNEY_STATIONS).toBe('AWAITING_JOURNEY_STATIONS');
      expect(FSMState.AWAITING_JOURNEY_TIME).toBe('AWAITING_JOURNEY_TIME');
      expect(FSMState.AWAITING_JOURNEY_CONFIRM).toBe('AWAITING_JOURNEY_CONFIRM');
      expect(FSMState.AWAITING_TICKET_UPLOAD).toBe('AWAITING_TICKET_UPLOAD');
      expect(FSMState.AWAITING_CLAIM_STATUS).toBe('AWAITING_CLAIM_STATUS');
      expect(FSMState.ERROR).toBe('ERROR');
    });
  });

  describe('getState', () => {
    it('should return START when no state exists in Redis', async () => {
      // Arrange - Redis returns null
      vi.mocked(mockRedis.get).mockResolvedValueOnce(null);

      // Act
      const result = await fsmService.getState(TEST_PHONE_NUMBER);

      // Assert
      expect(mockRedis.get).toHaveBeenCalledWith(TEST_STATE_KEY);
      expect(result).toEqual({
        state: FSMState.START,
        data: {},
      });
    });

    it('should return stored state and data from Redis', async () => {
      // Arrange
      const storedState = {
        state: FSMState.AWAITING_OTP,
        data: { verificationSid: 'VA1234567890' },
      };

      vi.mocked(mockRedis.get).mockResolvedValueOnce(JSON.stringify(storedState));

      // Act
      const result = await fsmService.getState(TEST_PHONE_NUMBER);

      // Assert
      expect(mockRedis.get).toHaveBeenCalledWith(TEST_STATE_KEY);
      expect(result).toEqual(storedState);
    });

    it('should return START when Redis data is corrupted', async () => {
      // Arrange - Invalid JSON
      vi.mocked(mockRedis.get).mockResolvedValueOnce('invalid-json{');

      // Act
      const result = await fsmService.getState(TEST_PHONE_NUMBER);

      // Assert
      expect(result).toEqual({
        state: FSMState.START,
        data: {},
      });
    });

    it('should handle Redis connection errors gracefully', async () => {
      // Arrange
      vi.mocked(mockRedis.get).mockRejectedValueOnce(new Error('Redis connection lost'));

      // Act & Assert
      await expect(fsmService.getState(TEST_PHONE_NUMBER)).rejects.toThrow('Redis connection lost');
    });
  });

  describe('setState', () => {
    it('should store state and data in Redis with 24-hour TTL', async () => {
      // Arrange
      const newState = FSMState.AWAITING_OTP;
      const stateData = { verificationSid: 'VA1234567890', attempts: 1 };

      vi.mocked(mockRedis.setex).mockResolvedValueOnce('OK');

      // Act
      await fsmService.setState(TEST_PHONE_NUMBER, newState, stateData);

      // Assert - ioredis uses setex(key, seconds, value)
      expect(mockRedis.setex).toHaveBeenCalledWith(
        TEST_STATE_KEY,
        86400, // 24 hours in seconds
        JSON.stringify({ state: newState, data: stateData })
      );
    });

    it('should allow storing state without data', async () => {
      // Arrange
      vi.mocked(mockRedis.setex).mockResolvedValueOnce('OK');

      // Act
      await fsmService.setState(TEST_PHONE_NUMBER, FSMState.AUTHENTICATED);

      // Assert
      expect(mockRedis.setex).toHaveBeenCalledWith(
        TEST_STATE_KEY,
        86400,
        JSON.stringify({ state: FSMState.AUTHENTICATED, data: {} })
      );
    });

    it('should overwrite existing state in Redis', async () => {
      // Arrange - Previous state exists
      const previousState = {
        state: FSMState.AWAITING_TERMS,
        data: { previousAttempt: 1 },
      };

      vi.mocked(mockRedis.get).mockResolvedValueOnce(JSON.stringify(previousState));
      vi.mocked(mockRedis.setex).mockResolvedValueOnce('OK');

      // Act
      await fsmService.setState(TEST_PHONE_NUMBER, FSMState.AWAITING_OTP, { verificationSid: 'VA123' });

      // Assert - Should replace previous state
      expect(mockRedis.setex).toHaveBeenCalledWith(
        TEST_STATE_KEY,
        86400,
        JSON.stringify({ state: FSMState.AWAITING_OTP, data: { verificationSid: 'VA123' } })
      );
    });

    it('should throw error when Redis set fails', async () => {
      // Arrange
      vi.mocked(mockRedis.setex).mockRejectedValueOnce(new Error('Redis write failed'));

      // Act & Assert
      await expect(fsmService.setState(TEST_PHONE_NUMBER, FSMState.START)).rejects.toThrow('Redis write failed');
    });
  });

  describe('deleteState', () => {
    it('should delete state from Redis', async () => {
      // Arrange
      vi.mocked(mockRedis.del).mockResolvedValueOnce(1); // 1 key deleted

      // Act
      await fsmService.deleteState(TEST_PHONE_NUMBER);

      // Assert
      expect(mockRedis.del).toHaveBeenCalledWith(TEST_STATE_KEY);
    });

    it('should not throw error when state does not exist', async () => {
      // Arrange
      vi.mocked(mockRedis.del).mockResolvedValueOnce(0); // 0 keys deleted

      // Act & Assert - Should not throw
      await expect(fsmService.deleteState(TEST_PHONE_NUMBER)).resolves.not.toThrow();
    });

    it('should throw error when Redis delete fails', async () => {
      // Arrange
      vi.mocked(mockRedis.del).mockRejectedValueOnce(new Error('Redis delete failed'));

      // Act & Assert
      await expect(fsmService.deleteState(TEST_PHONE_NUMBER)).rejects.toThrow('Redis delete failed');
    });
  });

  describe('getStateKey', () => {
    it('should generate correct Redis key with fsm:state: prefix', async () => {
      // Arrange
      vi.mocked(mockRedis.get).mockResolvedValueOnce(null);

      // Act
      await fsmService.getState(TEST_PHONE_NUMBER);

      // Assert - Verify key format
      expect(mockRedis.get).toHaveBeenCalledWith('fsm:state:+447700900123');
    });

    it('should handle phone numbers with different formats', async () => {
      // Arrange
      const phoneVariations = ['+447700900123', '447700900123', '+44 7700 900123'];

      for (const phone of phoneVariations) {
        vi.mocked(mockRedis.get).mockResolvedValueOnce(null);

        // Act
        await fsmService.getState(phone);

        // Assert - Should use phone as-is (normalization happens elsewhere)
        expect(mockRedis.get).toHaveBeenCalledWith(`fsm:state:${phone}`);
      }
    });
  });

  describe('transitionTo', () => {
    it('should transition from one state to another', async () => {
      // Arrange
      const currentState = {
        state: FSMState.AWAITING_TERMS,
        data: { termsShownAt: '2025-01-01T10:00:00Z' },
      };

      vi.mocked(mockRedis.get).mockResolvedValueOnce(JSON.stringify(currentState));
      vi.mocked(mockRedis.setex).mockResolvedValueOnce('OK');

      // Act
      await fsmService.transitionTo(TEST_PHONE_NUMBER, FSMState.AWAITING_OTP, { verificationSid: 'VA123' });

      // Assert - ioredis uses setex(key, seconds, value)
      expect(mockRedis.setex).toHaveBeenCalledWith(
        TEST_STATE_KEY,
        86400,
        JSON.stringify({ state: FSMState.AWAITING_OTP, data: { verificationSid: 'VA123' } })
      );
    });

    it('should preserve previous data when merging is requested', async () => {
      // Arrange
      const currentState = {
        state: FSMState.AWAITING_JOURNEY_STATIONS,
        data: { journeyDate: '2025-01-15' },
      };

      vi.mocked(mockRedis.get).mockResolvedValueOnce(JSON.stringify(currentState));
      vi.mocked(mockRedis.setex).mockResolvedValueOnce('OK');

      // Act
      await fsmService.transitionTo(
        TEST_PHONE_NUMBER,
        FSMState.AWAITING_JOURNEY_TIME,
        { fromStation: 'London', toStation: 'Manchester' },
        true // merge with previous data
      );

      // Assert - Should merge data (setex args: key, ttl, value)
      const callArgs = vi.mocked(mockRedis.setex).mock.calls[0];
      const storedData = JSON.parse(callArgs[2] as string);
      expect(storedData.data).toEqual({
        journeyDate: '2025-01-15', // Preserved from previous state
        fromStation: 'London',
        toStation: 'Manchester',
      });
    });
  });
});
