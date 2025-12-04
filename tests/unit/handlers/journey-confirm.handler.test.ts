/**
 * Journey Confirm Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.8 Journey Confirm Handler
 * Per ADR-014: These tests define the behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { journeyConfirmHandler } from '../../../src/handlers/journey-confirm.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

describe('Journey Confirm Handler', () => {
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
      messageBody: 'YES',
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
      correlationId: 'test-corr-id',
    };
  });

  describe('Confirmation accepted (YES)', () => {
    it('should accept "YES"', async () => {
      mockContext.messageBody = 'YES';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('ticket');
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
    });

    it('should accept "yes" (lowercase)', async () => {
      mockContext.messageBody = 'yes';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
    });
  });

  describe('Confirmation rejected (NO)', () => {
    it('should accept "NO"', async () => {
      mockContext.messageBody = 'NO';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('when');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should accept "no" (lowercase)', async () => {
      mockContext.messageBody = 'no';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should clear journey data from state', async () => {
      mockContext.messageBody = 'NO';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.journeyCleared).toBe(true);
    });
  });

  describe('Invalid input', () => {
    it('should reject other input', async () => {
      mockContext.messageBody = 'MAYBE';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('YES');
      expect(result.response).toContain('NO');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });
  });
});
