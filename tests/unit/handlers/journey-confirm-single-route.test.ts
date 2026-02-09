/**
 * TD-WHATSAPP-056: Journey Confirm Handler - Single Route NO Path Tests
 *
 * TECHNICAL DEBT CONTEXT:
 * When journey-matcher returns only 1 route and user says "NO":
 * 1. journey-confirm.handler says "Let me find alternative routes"
 * 2. Transitions to AWAITING_ROUTING_ALTERNATIVE
 * 3. But allRoutes has only 1 entry (the route user just rejected)
 * 4. routing-alternative.handler shows "Reply 1, 2, 3 or NONE" with no routes listed
 *
 * ROOT CAUSE: Two-message FSM architecture — handler registered for
 * AWAITING_ROUTING_ALTERNATIVE can never see currentState === AWAITING_JOURNEY_CONFIRM.
 * State transition happens BEFORE next handler invocation.
 *
 * REQUIRED FIX:
 * - AC-1: When user says NO and allRoutes.length === 1, respond with "only route"
 *         message and stay in AWAITING_JOURNEY_CONFIRM (re-prompt YES/NO)
 * - AC-2: When user says NO and allRoutes.length > 1, build Set 1 alternatives
 *         from allRoutes.slice(1, 4), transition to AWAITING_ROUTING_ALTERNATIVE
 *
 * Per ADR-014: Tests written FIRST, implementation follows
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

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

// Import handler after mocks
import { journeyConfirmHandler } from '../../../src/handlers/journey-confirm.handler';

describe('TD-WHATSAPP-056: Journey Confirm Handler - Single Route NO Path', () => {
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
      messageBody: 'NO',
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

  describe('AC-1: Single-route NO path stays in AWAITING_JOURNEY_CONFIRM with "only route" message', () => {
    it('should stay in AWAITING_JOURNEY_CONFIRM when allRoutes has only 1 route (was: transitioning to AWAITING_ROUTING_ALTERNATIVE)', async () => {
      // AC-1: Single-route scenario — no alternatives available
      // BEHAVIOR: User says NO, but journey-matcher only returned 1 route
      // EXPECTED: Handler should inform user this is the only available route, stay in same state

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        ...mockContext.stateData,
        allRoutes: [
          {
            legs: [{ from: 'Abergavenny', to: 'Hereford', departure: '08:31', arrival: '09:00', operator: 'TfW' }],
            totalDuration: '29m',
            isDirect: true,
          },
        ], // Only 1 route — the one user just rejected
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: Response explains this is the only available route
      expect(result.response).toContain('only');
      expect(result.response).toContain('route');

      // Assert: Stay in AWAITING_JOURNEY_CONFIRM (re-prompt YES/NO)
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);

      // Assert: Should NOT transition to AWAITING_ROUTING_ALTERNATIVE
      expect(result.nextState).not.toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
    });

    it('should preserve all stateData fields when staying in same state (AC-1)', async () => {
      // AC-1: Ensure stateData is preserved across re-prompts

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        travelDate: '2026-01-24',
        journeyId: 'test-journey-123',
        origin: 'AGV',
        destination: 'HFD',
        originName: 'Abergavenny',
        destinationName: 'Hereford',
        departureTime: '08:30',
        matchedRoute: {
          legs: [{ from: 'Abergavenny', to: 'Hereford', departure: '08:31', arrival: '09:00', operator: 'TfW' }],
          totalDuration: '29m',
        },
        allRoutes: [
          {
            legs: [{ from: 'Abergavenny', to: 'Hereford', departure: '08:31', arrival: '09:00', operator: 'TfW' }],
            totalDuration: '29m',
          },
        ],
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: All previous stateData fields preserved
      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.journeyId).toBe('test-journey-123');
      expect(result.stateData?.origin).toBe('AGV');
      expect(result.stateData?.destination).toBe('HFD');
      expect(result.stateData?.departureTime).toBe('08:30');
      expect(result.stateData?.matchedRoute).toBeDefined();
      expect(result.stateData?.allRoutes).toBeDefined();
    });

    it('should suggest user try different time when rejecting only available route (AC-1)', async () => {
      // AC-1: UX improvement — suggest actionable next step

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        ...mockContext.stateData,
        allRoutes: [
          {
            legs: [{ from: 'Abergavenny', to: 'Hereford', departure: '08:31', arrival: '09:00', operator: 'TfW' }],
            totalDuration: '29m',
          },
        ],
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: Response suggests trying different time
      expect(result.response).toMatch(/try.*different|different.*time/i);
    });

    it('should log single-route rejection scenario for analytics (AC-1)', async () => {
      // AC-1: Observability — track UX friction point

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        ...mockContext.stateData,
        allRoutes: [
          {
            legs: [{ from: 'Abergavenny', to: 'Hereford', departure: '08:31', arrival: '09:00', operator: 'TfW' }],
            totalDuration: '29m',
          },
        ],
      };

      await journeyConfirmHandler(mockContext);

      // Assert: Logger called with single-route rejection context
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/single.*route|only.*route/i),
        expect.objectContaining({
          correlationId: 'test-corr-id',
        })
      );
    });
  });

  describe('AC-2: Multi-route NO path transitions to AWAITING_ROUTING_ALTERNATIVE with Set 1 alternatives', () => {
    it('should transition to AWAITING_ROUTING_ALTERNATIVE when allRoutes has 2+ routes (was: empty alternatives)', async () => {
      // AC-2: Multi-route scenario — alternatives available from journey-time.handler
      // BEHAVIOR: User says NO, journey-matcher returned 4 routes
      // EXPECTED: Show routes [1], [2], [3] (skip [0] which is the matched route)

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        ...mockContext.stateData,
        allRoutes: [
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
            totalDuration: '29m',
            isDirect: true,
          },
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }],
            totalDuration: '29m',
            isDirect: true,
          },
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '10:31', arrival: '11:00' }],
            totalDuration: '29m',
            isDirect: true,
          },
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '11:31', arrival: '12:00' }],
            totalDuration: '29m',
            isDirect: true,
          },
        ],
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: Transition to AWAITING_ROUTING_ALTERNATIVE
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);

      // Assert: Response contains alternative routes (NOT empty)
      expect(result.response).toContain('alternative');

      // Assert: currentAlternatives populated in stateData with allRoutes.slice(1, 4)
      expect(result.stateData?.currentAlternatives).toBeDefined();
      expect(result.stateData?.currentAlternatives?.length).toBe(3); // Routes 1, 2, 3
      expect(result.stateData?.currentAlternatives?.[0].legs[0].departure).toBe('09:31'); // Second route
      expect(result.stateData?.currentAlternatives?.[1].legs[0].departure).toBe('10:31'); // Third route
      expect(result.stateData?.currentAlternatives?.[2].legs[0].departure).toBe('11:31'); // Fourth route
    });

    it('should use buildAlternativesResponse() to format alternative routes (AC-2, AC-5)', async () => {
      // AC-2, AC-5: buildAlternativesResponse() must be importable by journey-confirm.handler
      // BEHAVIOR: Response should match buildAlternativesResponse() output format

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        ...mockContext.stateData,
        allRoutes: [
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
            totalDuration: '29m',
          },
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }],
            totalDuration: '29m',
          },
        ],
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: Response contains buildAlternativesResponse() signature elements
      expect(result.response).toContain('1.'); // Option numbering
      expect(result.response).toContain('09:31'); // Route details
      expect(result.response).toContain('Reply'); // Call to action
      expect(result.response).toMatch(/1.*2.*3.*NONE/s); // Options (may not have 2/3 if only 1 alternative)
    });

    it('should handle case where allRoutes has only 2 routes total (show only 1 alternative) - AC-2', async () => {
      // AC-2: Edge case — only 1 alternative available (allRoutes.slice(1, 4) yields 1 route)

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        ...mockContext.stateData,
        allRoutes: [
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
            totalDuration: '29m',
          },
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }],
            totalDuration: '29m',
          },
        ],
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: Transition to AWAITING_ROUTING_ALTERNATIVE
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);

      // Assert: currentAlternatives has only 1 route
      expect(result.stateData?.currentAlternatives?.length).toBe(1);
      expect(result.stateData?.currentAlternatives?.[0].legs[0].departure).toBe('09:31');

      // Assert: Response shows only 1 option
      expect(result.response).toContain('1.');
      expect(result.response).toContain('09:31');
    });

    it('should set alternativeCount to 1 when transitioning to routing alternative state (AC-2)', async () => {
      // AC-2: alternativeCount tracks how many sets of alternatives shown (for 3-set limit)

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        ...mockContext.stateData,
        allRoutes: [
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
            totalDuration: '29m',
          },
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }],
            totalDuration: '29m',
          },
        ],
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: alternativeCount set to 1 (this is Set 1)
      expect(result.stateData?.alternativeCount).toBe(1);
    });

    it('should preserve all stateData fields when transitioning to routing alternative (AC-2)', async () => {
      // AC-2: Ensure journey context propagates correctly

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        travelDate: '2026-01-24',
        journeyId: 'test-journey-123',
        origin: 'AGV',
        destination: 'HFD',
        originName: 'Abergavenny',
        destinationName: 'Hereford',
        departureTime: '08:30',
        matchedRoute: {
          legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
          totalDuration: '29m',
        },
        allRoutes: [
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
            totalDuration: '29m',
          },
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }],
            totalDuration: '29m',
          },
        ],
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: All previous stateData fields preserved
      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.journeyId).toBe('test-journey-123');
      expect(result.stateData?.origin).toBe('AGV');
      expect(result.stateData?.destination).toBe('HFD');
      expect(result.stateData?.originName).toBe('Abergavenny');
      expect(result.stateData?.destinationName).toBe('Hereford');
      expect(result.stateData?.departureTime).toBe('08:30');
    });
  });

  describe('Edge case: allRoutes missing or undefined', () => {
    it('should treat missing allRoutes as single-route scenario (AC-1 fallback)', async () => {
      // EDGE CASE: journey-time.handler failed to populate allRoutes
      // BEHAVIOR: Treat as single-route scenario (stay in AWAITING_JOURNEY_CONFIRM)

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        ...mockContext.stateData,
        allRoutes: undefined, // Missing
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: Stay in AWAITING_JOURNEY_CONFIRM (single-route fallback)
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
      expect(result.response).toContain('only');
    });

    it('should treat empty allRoutes array as single-route scenario (AC-1 fallback)', async () => {
      // EDGE CASE: allRoutes is empty array

      mockContext.messageBody = 'NO';
      mockContext.stateData = {
        ...mockContext.stateData,
        allRoutes: [], // Empty
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: Stay in AWAITING_JOURNEY_CONFIRM
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
      expect(result.response).toContain('only');
    });
  });

  describe('Existing YES path unchanged', () => {
    it('should still accept YES and transition to AWAITING_TICKET_UPLOAD', async () => {
      // REQUIREMENT: AC-1/AC-2 changes should NOT break existing YES path

      mockContext.messageBody = 'YES';
      mockContext.stateData = {
        ...mockContext.stateData,
        allRoutes: [
          {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
            totalDuration: '29m',
          },
        ],
      };

      const result = await journeyConfirmHandler(mockContext);

      // Assert: YES path unaffected
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      expect(result.response).toContain('confirmed');
      expect(result.stateData?.journeyConfirmed).toBe(true);
    });
  });
});
