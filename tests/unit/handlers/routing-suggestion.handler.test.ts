/**
 * Routing Suggestion Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * USER STORY: Submitting a Journey to RailRepay
 * ACCEPTANCE CRITERIA: AC-2, AC-3
 *
 * AC-2: If my journey required me to change stations, receive a message with the
 *       suggested routing for me to confirm is correct
 * AC-3: If the suggestion is incorrect, receive up to 3 alternative suggested
 *       routings until I confirm the correct routing
 *
 * CONTEXT: This tests NEW FSM states and handlers that DO NOT exist yet.
 * Per Jessie's Test Specification Guidelines (Phase 3.1), these tests are:
 * - Behavior-focused (test WHAT the system should do, not HOW)
 * - Interface-based (mock service boundaries, not internal functions)
 * - Runnable from Day 1 (will fail until Blake implements in Phase 3.2)
 * - No placeholder assertions (all assertions are completable)
 *
 * INTEGRATION POINTS:
 * - journey-matcher service: GET /routes?from=...&to=...&date=...&time=... (returns ranked routes)
 * - otp-router service: via journey-matcher (graph-based routing)
 * - FSM states: AWAITING_ROUTING_CONFIRM, AWAITING_ROUTING_ALTERNATIVE
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// Mock winston logger (infrastructure package mocking per Section 6.1.11)
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// Mock axios for HTTP client testing
vi.mock('axios');

/**
 * TD-WHATSAPP-028: Updated to mock axios for journey-matcher integration
 * Tests verify correct HTTP calls are made to journey-matcher service
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 */
import { routingSuggestionHandler } from '../../../src/handlers/routing-suggestion.handler';
import axios from 'axios';

describe('US-XXX: Submitting a Journey to RailRepay', () => {
  describe('AC-2: Routing Suggestion Handler (Complex Journey with Interchanges)', () => {
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

      /**
       * CONTEXT: User has submitted journey details (date, origin, destination, time)
       * System detected journey requires interchange (PAD -> BRI -> CDF)
       * FSM now in AWAITING_ROUTING_CONFIRM state waiting for user confirmation
       */
      mockContext = {
        phoneNumber: '+447700900123',
        messageBody: 'YES', // User confirming suggested route
        messageSid: 'SM123',
        user: mockUser,
        currentState: FSMState.AWAITING_ROUTING_CONFIRM,
        correlationId: 'test-corr-id',
      };

      // Setup environment variable for journey-matcher API
      process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.test:3001';

      // TD-WHATSAPP-028: Handler now uses REAL HTTP client to journey-matcher
      // Endpoint: GET /routes?from=...&to=...&date=...&time=...
      // Blake implemented this in Phase TD-2

      // Mock axios response for journey-matcher API
      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: {
          routes: [
            {
              legs: [
                { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
                { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '11:45', arrival: '12:15' },
              ],
              totalDuration: '2h 15m',
            },
          ],
        },
      });

      // Clear mock call history
      vi.clearAllMocks();
    });

    afterEach(() => {
      // Clean up environment variables (per Section 6.2.1)
      delete process.env.JOURNEY_MATCHER_URL;
    });

    describe('When journey requires interchange', () => {
      it('should present suggested routing with numbered options when user submits journey details', async () => {
        /**
         * BEHAVIOR: System analyzes journey (PAD -> CDF) via journey-matcher
         * Journey-matcher calls otp-router, detects interchange required
         * System transitions to AWAITING_ROUTING_CONFIRM
         * System sends message showing suggested route with leg-by-leg breakdown
         */
        // Arrange: Simulate entering AWAITING_ROUTING_CONFIRM state
        const journeyData = {
          journeyId: 'journey-456',
          origin: 'PAD',
          destination: 'CDF',
          suggestedRoute: {
            legs: [
              { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
              { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '11:45', arrival: '12:15' },
            ],
            totalDuration: '2h 15m',
          },
        };

        // Act: Trigger routing suggestion (this would be called when journey analysis completes)
        const result = await routingSuggestionHandler({
          ...mockContext,
          currentState: FSMState.AWAITING_JOURNEY_TIME, // State before transition
          messageBody: '10:00', // User submitted journey time
          stateData: {
            journeyId: journeyData.journeyId, // Required for journey-matcher API call
            origin: 'PAD',
            destination: 'CDF',
            travelDate: '2024-12-20',
            departureTime: '10:00',
          },
        });

        // Assert: Response contains route breakdown
        expect(result.response).toContain('requires a change');
        expect(result.response).toContain('PAD');
        expect(result.response).toContain('BRI');
        expect(result.response).toContain('CDF');
        expect(result.response).toContain('10:00');
        expect(result.response).toContain('11:30');
        expect(result.response).toContain('11:45');
        expect(result.response).toContain('12:15');

        // Assert: Transitions to AWAITING_ROUTING_CONFIRM
        expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);

        // Assert: Journey data stored in state for confirmation
        expect(result.stateData).toBeDefined();
        expect(result.stateData?.journeyId).toBe('journey-456');
        expect(result.stateData?.suggestedRoute).toBeDefined();
      });

      it('should include confirmation prompt asking user to verify routing is correct', async () => {
        // Act
        const result = await routingSuggestionHandler({
          ...mockContext,
          currentState: FSMState.AWAITING_JOURNEY_TIME,
          messageBody: '10:00',
          stateData: {
            journeyId: 'journey-456', // Required for journey-matcher API call
            origin: 'PAD',
            destination: 'CDF',
            travelDate: '2024-12-20',
            departureTime: '10:00',
          },
        });

        // Assert: Message asks for confirmation
        expect(result.response).toContain('correct');
        expect(result.response).toMatch(/reply.*yes/i);
        expect(result.response).toMatch(/reply.*no/i);
      });

      it('should accept YES to confirm suggested routing is correct', async () => {
        // Arrange: User in AWAITING_ROUTING_CONFIRM state
        mockContext.messageBody = 'YES';
        mockContext.currentState = FSMState.AWAITING_ROUTING_CONFIRM;

        // Act
        const result = await routingSuggestionHandler(mockContext);

        // Assert: Confirmation accepted, proceeds to next step (ticket upload)
        expect(result.response).toContain('Perfect');
        expect(result.response).toContain('ticket');
        expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      });

      it('should accept "yes" (case insensitive)', async () => {
        // Arrange
        mockContext.messageBody = 'yes';

        // Act
        const result = await routingSuggestionHandler(mockContext);

        // Assert
        expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      });

      it('should accept NO to request alternative routing', async () => {
        // Arrange: User disagrees with suggested route
        mockContext.messageBody = 'NO';

        // Act
        const result = await routingSuggestionHandler(mockContext);

        // Assert: Transitions to AWAITING_ROUTING_ALTERNATIVE state
        expect(result.response).toContain('alternative');
        expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);

        // Assert: Tracks rejection count (for max 3 alternatives limit)
        expect(result.stateData?.alternativeCount).toBe(1);
      });

      it('should store confirmed routing in journey record when user accepts', async () => {
        // Arrange
        mockContext.messageBody = 'YES';

        // Act
        const result = await routingSuggestionHandler(mockContext);

        // Assert: State data includes confirmation for journey-matcher update
        expect(result.stateData).toBeDefined();
        expect(result.stateData?.routingConfirmed).toBe(true);
      });
    });

    describe('When user input is invalid', () => {
      it('should reject input other than YES/NO and stay in AWAITING_ROUTING_CONFIRM', async () => {
        // Arrange
        mockContext.messageBody = 'MAYBE';

        // Act
        const result = await routingSuggestionHandler(mockContext);

        // Assert
        expect(result.response).toContain('YES');
        expect(result.response).toContain('NO');
        expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
      });
    });

    describe('TD-WHATSAPP-039: Timeout on External HTTP Calls', () => {
      /**
       * TD CONTEXT: routing-suggestion.handler makes HTTP calls to journey-matcher without timeout
       * REQUIRED FIX: All axios calls must include timeout: 15000 (15 seconds)
       * ERROR HANDLING: Timeout errors must return user-friendly message and transition to ERROR state
       */
      beforeEach(() => {
        // Ensure environment variable is set (per Section 6.2.1)
        process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.test:3001';
      });

      afterEach(() => {
        delete process.env.JOURNEY_MATCHER_URL;
      });

      it('should include timeout option in axios HTTP call (was: no timeout configured)', async () => {
        // Arrange: Mock axios to capture config
        const axiosGetSpy = vi.spyOn(axios, 'get');
        axiosGetSpy.mockResolvedValue({
          status: 200,
          data: {
            routes: [{
              legs: [
                { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
              ],
              totalDuration: '1h 30m',
            }],
          },
        });

        // Act: Trigger routing suggestion handler
        await routingSuggestionHandler({
          ...mockContext,
          currentState: FSMState.AWAITING_JOURNEY_TIME,
          messageBody: '10:00',
          stateData: {
            journeyId: 'journey-456',
            origin: 'PAD',
            destination: 'BRI',
            travelDate: '2024-12-20',
            departureTime: '10:00',
          },
        });

        // Assert: Verify axios.get was called with timeout config
        expect(axiosGetSpy).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            timeout: 15000, // 15 seconds
          })
        );
      });

      it('should return user-friendly message when journey-matcher times out (was: unhandled timeout)', async () => {
        // Arrange: Mock axios to throw timeout error (ECONNABORTED)
        const timeoutError = new Error('timeout of 15000ms exceeded');
        (timeoutError as any).code = 'ECONNABORTED';
        vi.mocked(axios.get).mockRejectedValue(timeoutError);

        // Act
        const result = await routingSuggestionHandler({
          ...mockContext,
          currentState: FSMState.AWAITING_JOURNEY_TIME,
          messageBody: '10:00',
          stateData: {
            journeyId: 'journey-456',
            origin: 'PAD',
            destination: 'CDF',
            travelDate: '2024-12-20',
            departureTime: '10:00',
          },
        });

        // Assert: User receives friendly error message (not technical error)
        expect(result.response).toContain('journey routing service');
        expect(result.response).toContain('unavailable');
        expect(result.response).toContain('try again later');
        expect(result.response).not.toContain('ECONNABORTED'); // No technical error exposed
        expect(result.response).not.toContain('timeout'); // No technical jargon
      });

      it('should transition to ERROR state when timeout occurs', async () => {
        // Arrange
        const timeoutError = new Error('timeout of 15000ms exceeded');
        (timeoutError as any).code = 'ECONNABORTED';
        vi.mocked(axios.get).mockRejectedValue(timeoutError);

        // Act
        const result = await routingSuggestionHandler({
          ...mockContext,
          currentState: FSMState.AWAITING_JOURNEY_TIME,
          messageBody: '10:00',
          stateData: {
            journeyId: 'journey-456',
            origin: 'PAD',
            destination: 'CDF',
            travelDate: '2024-12-20',
            departureTime: '10:00',
          },
        });

        // Assert: Transitions to ERROR state (allows retry from start)
        expect(result.nextState).toBe(FSMState.ERROR);
      });

      it('should log timeout error with correlation ID for observability', async () => {
        // Arrange
        const timeoutError = new Error('timeout of 15000ms exceeded');
        (timeoutError as any).code = 'ECONNABORTED';
        vi.mocked(axios.get).mockRejectedValue(timeoutError);

        // Act
        await routingSuggestionHandler({
          ...mockContext,
          correlationId: 'test-timeout-correlation',
          currentState: FSMState.AWAITING_JOURNEY_TIME,
          messageBody: '10:00',
          stateData: {
            journeyId: 'journey-456',
            origin: 'PAD',
            destination: 'CDF',
            travelDate: '2024-12-20',
            departureTime: '10:00',
          },
        });

        // Assert: Winston logger called with error and correlation ID
        expect(sharedLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('journey-matcher'),
          expect.objectContaining({
            correlationId: 'test-timeout-correlation',
            error: expect.stringContaining('ECONNABORTED'),
          })
        );
      });
    });
  });

  describe('TD-WHATSAPP-054 AC-6: stateData Propagation in routing-suggestion.handler', () => {
    /**
     * TD CONTEXT: routing-suggestion.handler YES path stores only { routingConfirmed: true },
     * NO path stores only { alternativeCount: 1 }, dropping all journey context.
     *
     * REQUIRED FIX: Use spread operator to preserve all stateData fields.
     */

    let mockContextWithStateData: HandlerContext;
    let mockUser: User;

    beforeEach(() => {
      // Setup environment variable
      process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.test:3001';

      mockUser = {
        id: 'user-123',
        phone_number: '+447700900123',
        verified_at: new Date('2024-11-20T10:00:00Z'),
        created_at: new Date('2024-11-20T10:00:00Z'),
        updated_at: new Date('2024-11-20T10:00:00Z'),
      };

      mockContextWithStateData = {
        phoneNumber: '+447700900123',
        messageBody: 'YES',
        messageSid: 'SM123',
        user: mockUser,
        currentState: FSMState.AWAITING_ROUTING_CONFIRM,
        correlationId: 'test-corr-id',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          suggestedRoute: {
            legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
            totalDuration: '29m',
          },
          originName: 'Abergavenny',
          destinationName: 'Hereford',
        },
      };
    });

    afterEach(() => {
      delete process.env.JOURNEY_MATCHER_URL;
    });

    it('should preserve all stateData fields when user says YES (was: storing only routingConfirmed)', async () => {
      // AC-6: YES path should preserve journey context using spread operator

      mockContextWithStateData.messageBody = 'YES';
      const result = await routingSuggestionHandler(mockContextWithStateData);

      // Assert: All previous stateData fields preserved
      expect(result.stateData?.journeyId).toBe('journey-789');
      expect(result.stateData?.origin).toBe('AGV');
      expect(result.stateData?.destination).toBe('HFD');
      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.departureTime).toBe('08:30');
      expect(result.stateData?.suggestedRoute).toBeDefined();
      expect(result.stateData?.originName).toBe('Abergavenny');
      expect(result.stateData?.destinationName).toBe('Hereford');

      // Assert: New fields added
      expect(result.stateData?.routingConfirmed).toBe(true);
      expect(result.stateData?.confirmedRoute).toEqual(mockContextWithStateData.stateData?.suggestedRoute);
    });

    it('should preserve all stateData fields when user says NO (was: storing only alternativeCount)', async () => {
      // AC-6: NO path should preserve journey context using spread operator

      mockContextWithStateData.messageBody = 'NO';
      const result = await routingSuggestionHandler(mockContextWithStateData);

      // Assert: All previous stateData fields preserved
      expect(result.stateData?.journeyId).toBe('journey-789');
      expect(result.stateData?.origin).toBe('AGV');
      expect(result.stateData?.destination).toBe('HFD');
      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.departureTime).toBe('08:30');
      expect(result.stateData?.suggestedRoute).toBeDefined();

      // Assert: New field added
      expect(result.stateData?.alternativeCount).toBe(1);
    });

    it('should set confirmedRoute equal to suggestedRoute when user says YES', async () => {
      // AC-6: YES path should copy suggestedRoute to confirmedRoute

      mockContextWithStateData.messageBody = 'YES';
      const result = await routingSuggestionHandler(mockContextWithStateData);

      expect(result.stateData?.confirmedRoute).toBeDefined();
      expect(result.stateData?.confirmedRoute).toEqual(mockContextWithStateData.stateData?.suggestedRoute);
    });
  });
});
