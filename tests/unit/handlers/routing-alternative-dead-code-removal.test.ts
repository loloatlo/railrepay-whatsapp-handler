/**
 * TD-WHATSAPP-056: Routing Alternative Handler - Dead Code Removal Tests
 *
 * TECHNICAL DEBT CONTEXT:
 * Set 1 code block (routing-alternative.handler.ts lines 30-63) is DEAD CODE:
 * - Checks `ctx.currentState === AWAITING_JOURNEY_CONFIRM`
 * - But handler is registered for AWAITING_ROUTING_ALTERNATIVE
 * - By the time handler runs, state is already AWAITING_ROUTING_ALTERNATIVE
 * - Two-message FSM architecture means handler never sees previous state
 *
 * REQUIRED FIX:
 * - AC-3: Remove dead code block (lines 30-63)
 * - Move Set 1 logic to journey-confirm.handler (where currentState IS AWAITING_JOURNEY_CONFIRM)
 * - AC-4: Add first-entry fallback in routing-alternative.handler when currentAlternatives missing
 *
 * Per ADR-014: Tests written FIRST, implementation follows
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';
import axios from 'axios';

// Use vi.hoisted() to ensure mock logger is available before mock hoisting
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

// Mock axios for journey-matcher API calls
vi.mock('axios');

// Import handler after mocks
import { routingAlternativeHandler } from '../../../src/handlers/routing-alternative.handler';

describe('TD-WHATSAPP-056: Routing Alternative Handler - Dead Code Removal', () => {
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
      messageBody: '1',
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
      correlationId: 'test-corr-id',
    };

    process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.test:3001';

    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.JOURNEY_MATCHER_URL;
  });

  describe('AC-3: Dead code block removed (lines 30-63)', () => {
    it('should NOT execute Set 1 logic when entering AWAITING_ROUTING_ALTERNATIVE (was: dead code path)', async () => {
      // AC-3: Verify dead code block removed
      // BEHAVIOR: Handler should never check `currentState === AWAITING_JOURNEY_CONFIRM`
      // REASON: Handler is registered for AWAITING_ROUTING_ALTERNATIVE — by the time it runs, state is already changed

      // This test simulates the OLD broken scenario — handler receives context with AWAITING_JOURNEY_CONFIRM
      // After AC-3 fix, this path should not exist (handler only handles AWAITING_ROUTING_ALTERNATIVE)

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_JOURNEY_CONFIRM, // Simulate old dead code path
        messageBody: 'NO',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          allRoutes: [
            { legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }], totalDuration: '29m' },
            { legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }], totalDuration: '29m' },
          ],
        },
      });

      // Assert: Handler should return error or fallback (NOT Set 1 logic)
      // After AC-3 fix, this should transition to ERROR state (unhandled state)
      expect(result.nextState).toBe(FSMState.ERROR);
      expect(result.response).toContain('went wrong');
    });

    it('should only handle AWAITING_ROUTING_ALTERNATIVE state (AC-3 verification)', async () => {
      // AC-3: After dead code removal, handler should ONLY respond to AWAITING_ROUTING_ALTERNATIVE
      // BEHAVIOR: Verify handler requires currentState === AWAITING_ROUTING_ALTERNATIVE

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
        messageBody: '1',
        stateData: {
          journeyId: 'journey-789',
          currentAlternatives: [
            { legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }], totalDuration: '29m' },
          ],
        },
      });

      // Assert: Handler works correctly for AWAITING_ROUTING_ALTERNATIVE state
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      expect(result.stateData?.confirmedRoute).toBeDefined();
    });

    it('should NOT reference stateData.allRoutes in routing-alternative.handler (AC-3)', async () => {
      // AC-3: After dead code removal, routing-alternative.handler should ONLY use currentAlternatives
      // BEHAVIOR: allRoutes should NOT be accessed (that's journey-confirm.handler's responsibility)

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
        messageBody: '1',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          allRoutes: [
            { legs: [{ from: 'OLD', to: 'ROUTE', operator: 'X', departure: '00:00', arrival: '00:01' }], totalDuration: '1m' },
          ],
          currentAlternatives: [
            { legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }], totalDuration: '29m' },
          ],
        },
      });

      // Assert: Handler uses currentAlternatives, NOT allRoutes
      expect(result.stateData?.confirmedRoute?.legs[0].from).toBe('AGV'); // From currentAlternatives
      expect(result.stateData?.confirmedRoute?.legs[0].from).not.toBe('OLD'); // NOT from allRoutes
    });
  });

  describe('AC-4: First-entry fallback when currentAlternatives missing', () => {
    it('should call journey-matcher API when entering AWAITING_ROUTING_ALTERNATIVE with no currentAlternatives (was: error state)', async () => {
      // AC-4: First-entry fallback for edge case
      // SCENARIO: User somehow enters AWAITING_ROUTING_ALTERNATIVE without currentAlternatives in stateData
      // EXPECTED: Auto-fetch from journey-matcher API instead of crashing

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: {
          routes: [
            {
              legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '14:31', arrival: '15:00' }],
              totalDuration: '29m',
            },
            {
              legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '15:31', arrival: '16:00' }],
              totalDuration: '29m',
            },
          ],
        },
      });

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
        messageBody: '', // User just entered state (no input yet)
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          // currentAlternatives is MISSING (edge case)
        },
      });

      // Assert: API was called to fetch alternatives
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/routes'),
        expect.objectContaining({
          params: expect.objectContaining({
            from: 'AGV',
            to: 'HFD',
            date: '2026-01-24',
            time: '08:30',
            offset: 3, // First fallback fetch uses offset=3 (skip first 3 routes)
          }),
        })
      );

      // Assert: Response displays alternatives
      expect(result.response).toContain('14:31');
      expect(result.response).toContain('15:31');
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
    });

    it('should set alternativeCount to 1 during first-entry fallback (AC-4)', async () => {
      // AC-4: Ensure alternativeCount tracks correctly even for fallback path

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: {
          routes: [
            { legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '14:31', arrival: '15:00' }], totalDuration: '29m' },
          ],
        },
      });

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
        messageBody: '',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          // currentAlternatives missing
        },
      });

      // Assert: alternativeCount set to 1
      expect(result.stateData?.alternativeCount).toBe(1);
    });

    it('should preserve all stateData fields during fallback API call (AC-4)', async () => {
      // AC-4: Ensure journey context is not lost during fallback

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: {
          routes: [
            { legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '14:31', arrival: '15:00' }], totalDuration: '29m' },
          ],
        },
      });

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
        messageBody: '',
        stateData: {
          journeyId: 'journey-fallback-test',
          origin: 'AGV',
          destination: 'HFD',
          originName: 'Abergavenny',
          destinationName: 'Hereford',
          travelDate: '2026-01-24',
          departureTime: '08:30',
        },
      });

      // Assert: All previous stateData fields preserved
      expect(result.stateData?.journeyId).toBe('journey-fallback-test');
      expect(result.stateData?.origin).toBe('AGV');
      expect(result.stateData?.destination).toBe('HFD');
      expect(result.stateData?.originName).toBe('Abergavenny');
      expect(result.stateData?.destinationName).toBe('Hereford');
      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.departureTime).toBe('08:30');
    });

    it('should transition to ERROR if fallback API call fails (AC-4 error handling)', async () => {
      // AC-4: Fallback error handling

      vi.mocked(axios.get).mockRejectedValueOnce(new Error('API unavailable'));

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
        messageBody: '',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
        },
      });

      // Assert: Transition to ERROR with helpful message
      expect(result.nextState).toBe(FSMState.ERROR);
      expect(result.response).toContain('Unable to fetch');
    });

    it('should NOT trigger fallback when currentAlternatives exists (AC-4 boundary)', async () => {
      // AC-4: Fallback should ONLY trigger when currentAlternatives is missing
      // BEHAVIOR: If currentAlternatives exists, use it directly (no API call)

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
        messageBody: '1',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          currentAlternatives: [
            { legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }], totalDuration: '29m' },
          ],
        },
      });

      // Assert: No API call made (currentAlternatives used directly)
      expect(axios.get).not.toHaveBeenCalled();

      // Assert: Handler works normally
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      expect(result.stateData?.confirmedRoute).toBeDefined();
    });
  });

  describe('Existing NONE path unchanged (Set 2+)', () => {
    it('should still call journey-matcher API with offset when user says NONE (AC-4 does not affect this path)', async () => {
      // REQUIREMENT: AC-3/AC-4 changes should NOT break existing Set 2+ logic

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: {
          routes: [
            { legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '14:31', arrival: '15:00' }], totalDuration: '29m' },
          ],
        },
      });

      const result = await routingAlternativeHandler({
        ...mockContext,
        messageBody: 'NONE',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          alternativeCount: 1, // First set shown
        },
      });

      // Assert: API called with offset (Set 2)
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/routes'),
        expect.objectContaining({
          params: expect.objectContaining({
            offset: 3, // alternativeCount * 3 = 1 * 3 = 3
          }),
        })
      );

      // Assert: alternativeCount incremented
      expect(result.stateData?.alternativeCount).toBe(2);
    });
  });
});
