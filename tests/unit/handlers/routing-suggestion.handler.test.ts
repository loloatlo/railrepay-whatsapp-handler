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
 * - journey-matcher service: GET /journeys/:id/routes (returns ranked routes)
 * - otp-router service: via journey-matcher (graph-based routing)
 * - FSM states: AWAITING_ROUTING_CONFIRM, AWAITING_ROUTING_ALTERNATIVE
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';
import axios from 'axios';

// Mock axios for HTTP client testing
vi.mock('axios');

// Mock winston logger
vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

/**
 * IMPORT NOTE: These handlers DO NOT exist yet - Blake will create them
 * This test file will initially have import errors - that's expected
 */
// @ts-expect-error - Handler does not exist yet, Blake will create
import { routingSuggestionHandler } from '../../../src/handlers/routing-suggestion.handler';
// @ts-expect-error - Handler does not exist yet, Blake will create
import { routingAlternativeHandler } from '../../../src/handlers/routing-alternative.handler';

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

      // Mock axios GET for journey-matcher API
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
  });

  describe('AC-3: Alternative Routing Handler (Up to 3 Alternatives)', () => {
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
       * CONTEXT: User rejected initial routing suggestion
       * FSM now in AWAITING_ROUTING_ALTERNATIVE state
       * System will fetch alternative routes from journey-matcher
       */
      mockContext = {
        phoneNumber: '+447700900123',
        messageBody: '1', // User selecting first alternative
        messageSid: 'SM123',
        user: mockUser,
        currentState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
        correlationId: 'test-corr-id',
      };
    });

    describe('Presenting alternative routes', () => {
      it('should present numbered list of alternative routes when user rejects initial suggestion', async () => {
        /**
         * BEHAVIOR: System fetches alternative routes from journey-matcher
         * journey-matcher returns ranked alternatives from otp-router
         * System presents numbered options (1, 2, 3)
         */
        // Arrange: Simulate transition from AWAITING_ROUTING_CONFIRM to AWAITING_ROUTING_ALTERNATIVE
        const alternatives = [
          {
            number: 1,
            legs: [
              { from: 'PAD', to: 'RDG', operator: 'GWR', departure: '10:05', arrival: '10:35' },
              { from: 'RDG', to: 'CDF', operator: 'GWR', departure: '10:50', arrival: '12:20' },
            ],
            totalDuration: '2h 15m',
          },
          {
            number: 2,
            legs: [
              { from: 'PAD', to: 'BHM', operator: 'XC', departure: '10:10', arrival: '12:00' },
              { from: 'BHM', to: 'CDF', operator: 'XC', departure: '12:20', arrival: '13:45' },
            ],
            totalDuration: '3h 35m',
          },
          {
            number: 3,
            legs: [
              { from: 'PAD', to: 'SWA', operator: 'GWR', departure: '10:15', arrival: '13:30' },
              { from: 'SWA', to: 'CDF', operator: 'TfW', departure: '13:50', arrival: '14:45' },
            ],
            totalDuration: '4h 30m',
          },
        ];

        // Act: Trigger alternative routing presentation
        const result = await routingAlternativeHandler({
          ...mockContext,
          currentState: FSMState.AWAITING_ROUTING_CONFIRM,
          messageBody: 'NO', // User rejected initial suggestion
        });

        // Assert: Response contains numbered alternatives
        expect(result.response).toContain('alternative');
        expect(result.response).toContain('1.');
        expect(result.response).toContain('2.');
        expect(result.response).toContain('3.');

        // Assert: Each alternative shows route details
        expect(result.response).toContain('PAD');
        expect(result.response).toContain('RDG');
        expect(result.response).toContain('BHM');
        expect(result.response).toContain('SWA');

        // Assert: Transitions to AWAITING_ROUTING_ALTERNATIVE
        expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
      });

      it('should accept number selection (1, 2, or 3) to confirm alternative route', async () => {
        // Arrange: User selecting option 2
        mockContext.messageBody = '2';

        // Act
        const result = await routingAlternativeHandler(mockContext);

        // Assert: Selection accepted, proceeds to ticket upload
        expect(result.response).toContain('selected');
        expect(result.response).toContain('ticket');
        expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);

        // Assert: Selected route stored in state
        expect(result.stateData?.selectedAlternative).toBe(2);
        expect(result.stateData?.routingConfirmed).toBe(true);
      });

      it('should accept "1" to select first alternative', async () => {
        // Arrange
        mockContext.messageBody = '1';

        // Act
        const result = await routingAlternativeHandler(mockContext);

        // Assert
        expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
        expect(result.stateData?.selectedAlternative).toBe(1);
      });

      it('should accept "3" to select third alternative', async () => {
        // Arrange
        mockContext.messageBody = '3';

        // Act
        const result = await routingAlternativeHandler(mockContext);

        // Assert
        expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
        expect(result.stateData?.selectedAlternative).toBe(3);
      });
    });

    describe('Handling further rejections (max 3 alternatives)', () => {
      it('should allow "NONE" response to request more alternatives (if under limit)', async () => {
        // Arrange: User doesn't like any of the 3 alternatives, first rejection
        mockContext.messageBody = 'NONE';

        // Act
        const result = await routingAlternativeHandler(mockContext);

        // Assert: Fetches next set of alternatives
        expect(result.response).toContain('alternative');
        expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);

        // Assert: Increments alternative count
        expect(result.stateData?.alternativeCount).toBe(2);
      });

      it('should stop offering alternatives after 3 sets (max limit per AC-3)', async () => {
        /**
         * AC-3: "receive up to 3 alternative suggested routings"
         * After 3 sets of alternatives, system must stop and escalate
         */
        // Arrange: User has rejected 3 sets of alternatives (alternativeCount = 3)
        mockContext.messageBody = 'NONE';

        // Act
        const result = await routingAlternativeHandler({
          ...mockContext,
          stateData: { alternativeCount: 3 }, // Simulate state data from previous rejections
        });

        // Assert: No more alternatives offered, manual support required
        expect(result.response).toContain('unable to find');
        expect(result.response).toContain('manual');
        expect(result.nextState).toBe(FSMState.ERROR);

        // Assert: Escalation event published for human review
        expect(result.publishEvents).toBeDefined();
        expect(result.publishEvents?.length).toBeGreaterThan(0);
        expect(result.publishEvents?.[0].event_type).toBe('journey.routing_escalation');
      });
    });

    describe('Invalid input handling', () => {
      it('should reject invalid selection (not 1, 2, 3, or NONE)', async () => {
        // Arrange
        mockContext.messageBody = '4';

        // Act
        const result = await routingAlternativeHandler(mockContext);

        // Assert
        expect(result.response).toContain('1, 2, or 3');
        expect(result.response).toContain('NONE');
        expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
      });

      it('should reject non-numeric input (except NONE)', async () => {
        // Arrange
        mockContext.messageBody = 'MAYBE';

        // Act
        const result = await routingAlternativeHandler(mockContext);

        // Assert
        expect(result.response).toContain('select');
        expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
      });
    });
  });
});
