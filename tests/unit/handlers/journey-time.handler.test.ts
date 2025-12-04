/**
 * Journey Time Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.7 Journey Time Handler
 * Per ADR-014: These tests define the behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { journeyTimeHandler } from '../../../src/handlers/journey-time.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

describe('Journey Time Handler', () => {
  let mockContext: HandlerContext;
  let mockUser: User;

  beforeEach(() => {
    mockUser = {
      id: 'user-123',
      phone_number: '+447700900123',
      verified_at: new Date('2024-11-20T10:00:00Z'),
      created_at: new Date('2024-11-20T10:00:00Z'),
      updated_at: new Date('2024-11-20T10:00:00Z'),
    };

    mockContext = {
      phoneNumber: '+447700900123',
      messageBody: '14:30',
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.AWAITING_JOURNEY_TIME,
      correlationId: 'test-corr-id',
    };
  });

  describe('Valid times', () => {
    it('should accept 24-hour format "14:30"', async () => {
      mockContext.messageBody = '14:30';
      const result = await journeyTimeHandler(mockContext);
      expect(result.response).toContain('confirm');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should accept 12-hour format "2:30pm"', async () => {
      mockContext.messageBody = '2:30pm';
      const result = await journeyTimeHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should accept compact format "1430"', async () => {
      mockContext.messageBody = '1430';
      const result = await journeyTimeHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should store journey time in state data', async () => {
      mockContext.messageBody = '14:30';
      const result = await journeyTimeHandler(mockContext);
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.journeyTime).toBeDefined();
    });

    it('should show journey confirmation details', async () => {
      mockContext.messageBody = '14:30';
      const result = await journeyTimeHandler(mockContext);
      expect(result.response).toContain('14:30');
    });
  });

  describe('Invalid times', () => {
    it('should reject invalid time format', async () => {
      mockContext.messageBody = 'invalid';
      const result = await journeyTimeHandler(mockContext);
      expect(result.response).toContain('Invalid');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should provide helpful hint', async () => {
      mockContext.messageBody = 'xyz';
      const result = await journeyTimeHandler(mockContext);
      expect(result.response).toContain('14:30');
      expect(result.response).toContain('2:30pm');
    });
  });
});
