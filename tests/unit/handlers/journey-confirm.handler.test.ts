/**
 * Journey Confirm Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.8 Journey Confirm Handler
 * Per ADR-014: These tests define the behavior
 *
 * SIMPLIFIED: API call moved to journey-time.handler. This handler now only
 * handles YES/NO confirmation responses. Users have already seen the matched
 * route from journey-time.handler before reaching this state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// Use vi.hoisted() to ensure the mock logger is available before mock hoisting
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

// Mock winston logger
vi.mock('@railrepay/winston-logger', () => ({
  createLogger: () => mockLogger,
}));

// Import handler after mocks
import { journeyConfirmHandler } from '../../../src/handlers/journey-confirm.handler';

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
      stateData: {
        travelDate: '2026-01-24',
        journeyId: 'test-journey-123',
        origin: 'AGV',
        destination: 'HFD',
        originName: 'Abergavenny',
        destinationName: 'Hereford',
        departureTime: '08:30',
        matchedRoute: {
          legs: [
            { from: 'Abergavenny', to: 'Hereford', departure: '08:31', arrival: '09:00', operator: 'TfW' },
          ],
          totalDuration: '29m',
          isDirect: true,
        },
        isDirect: true,
      },
    };

    vi.clearAllMocks();
  });

  describe('Confirmation accepted (YES)', () => {
    it('should accept "YES" and transition to ticket upload', async () => {
      mockContext.messageBody = 'YES';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('confirmed');
      expect(result.response).toContain('ticket');
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
    });

    it('should accept "yes" (lowercase)', async () => {
      mockContext.messageBody = 'yes';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
    });

    it('should store confirmedRoute in stateData', async () => {
      mockContext.messageBody = 'YES';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.confirmedRoute).toBeDefined();
      expect(result.stateData?.journeyConfirmed).toBe(true);
    });

    it('should preserve previous stateData fields', async () => {
      mockContext.messageBody = 'YES';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.journeyId).toBe('test-journey-123');
      expect(result.stateData?.origin).toBe('AGV');
    });

    it('should log journey confirmation', async () => {
      mockContext.messageBody = 'YES';
      await journeyConfirmHandler(mockContext);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Journey confirmed by user',
        expect.objectContaining({
          correlationId: 'test-corr-id',
          journeyId: 'test-journey-123',
        })
      );
    });
  });

  describe('Confirmation rejected (NO)', () => {
    it('should accept "NO" and allow user to try different time', async () => {
      mockContext.messageBody = 'NO';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('alternative');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should accept "no" (lowercase)', async () => {
      mockContext.messageBody = 'no';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should preserve stateData and set needsAlternatives flag', async () => {
      mockContext.messageBody = 'NO';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.stateData?.needsAlternatives).toBe(true);
      expect(result.stateData?.origin).toBe('AGV'); // Preserved
    });
  });

  describe('Missing matchedRoute', () => {
    it('should return error when matchedRoute is missing', async () => {
      mockContext.messageBody = 'YES';
      mockContext.stateData = {
        travelDate: '2026-01-24',
        journeyId: 'test-journey-123',
        // matchedRoute is missing
      };

      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('went wrong');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });
  });

  describe('Invalid input', () => {
    it('should reject other input and stay in same state', async () => {
      mockContext.messageBody = 'MAYBE';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('YES');
      expect(result.response).toContain('NO');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should handle empty input', async () => {
      mockContext.messageBody = '';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should handle whitespace-only input', async () => {
      mockContext.messageBody = '   ';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });
  });
});
