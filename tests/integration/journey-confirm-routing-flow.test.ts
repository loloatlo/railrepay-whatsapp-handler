/**
 * TD-WHATSAPP-034: Integration Test - Journey Confirm → Routing → Ticket Flow
 *
 * CONTEXT: Verify correct FSM state transitions through routing flow
 *
 * This test verifies:
 * 1. journey-confirm.handler transitions to AWAITING_ROUTING_CONFIRM (NOT AWAITING_TICKET_UPLOAD)
 * 2. routing-suggestion.handler is invoked after confirmation
 * 3. Journey data (journeyId, origin, destination, travelDate, departureTime) flows through state transitions
 * 4. End-to-end flow: confirm YES → routing check → ticket upload
 *
 * Per ADR-014: Tests written BEFORE implementation
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 * Per Section 6.1.12: FSM transition testing verifies TRIGGER and OUTPUT states
 *
 * FSM TRANSITION TESTING:
 * - TRIGGER: AWAITING_JOURNEY_CONFIRM + "YES" → should reach routing-suggestion.handler
 * - OUTPUT: routing-suggestion.handler → should transition to AWAITING_TICKET_UPLOAD (after routing confirmed)
 * - NO ORPHAN HANDLERS: journey-confirm MUST NOT bypass routing flow
 *
 * These tests will FAIL until Blake:
 * 1. Changes journey-confirm.handler.ts line 24 from AWAITING_TICKET_UPLOAD to AWAITING_ROUTING_CONFIRM
 * 2. Updates journey-confirm.handler.ts to preserve stateData for routing handler
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FSMState } from '../../src/services/fsm.service';
import type { HandlerContext } from '../../src/handlers';
import type { User } from '../../src/db/types';
import { journeyConfirmHandler } from '../../src/handlers/journey-confirm.handler';
import { routingSuggestionHandler } from '../../src/handlers/routing-suggestion.handler';
import nock from 'nock';

// Mock winston logger
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

describe('TD-WHATSAPP-034: Integration - Journey Confirm → Routing → Ticket Flow', () => {
  let mockUser: User;
  const journeyMatcherUrl = 'http://journey-matcher-integration-test:3001';

  beforeEach(() => {
    mockUser = {
      id: 'user-flow-test-123',
      phone_number: '+447700900888',
      verified_at: new Date('2024-11-20T10:00:00Z'),
      created_at: new Date('2024-11-20T10:00:00Z'),
      updated_at: new Date('2024-11-20T10:00:00Z'),
    };

    // Set environment variable for routing-suggestion.handler
    process.env.JOURNEY_MATCHER_URL = journeyMatcherUrl;

    // Clear HTTP interceptors
    nock.cleanAll();
  });

  afterEach(() => {
    delete process.env.JOURNEY_MATCHER_URL;
    nock.cleanAll();
  });

  describe('FSM State Transition Flow', () => {
    it('should transition from AWAITING_JOURNEY_CONFIRM to AWAITING_ROUTING_CONFIRM when user confirms', async () => {
      /**
       * TRIGGER: AWAITING_JOURNEY_CONFIRM + "YES" input
       * EXPECTED OUTPUT: nextState = AWAITING_ROUTING_CONFIRM (NOT AWAITING_TICKET_UPLOAD)
       *
       * This is the CORE bug fix for TD-WHATSAPP-034
       */

      const confirmContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: 'YES',
        messageSid: 'SM-flow-test-1',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
        correlationId: 'flow-test-corr-1',
        stateData: {
          journeyId: 'journey-flow-abc',
          origin: 'PAD',
          destination: 'BRI',
          travelDate: '2024-11-25',
          departureTime: '10:15',
        },
      };

      const result = await journeyConfirmHandler(confirmContext);

      // Assert: Should transition to AWAITING_ROUTING_CONFIRM (not AWAITING_TICKET_UPLOAD)
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
      expect(result.response).toContain('routing'); // Response should mention routing
    });

    it('should preserve journey data in stateData for routing handler to use', async () => {
      /**
       * CRITICAL: routing-suggestion.handler requires journeyId, origin, destination, travelDate, departureTime
       * journey-confirm.handler MUST pass these fields through in stateData
       */

      const confirmContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: 'YES',
        messageSid: 'SM-flow-test-2',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
        correlationId: 'flow-test-corr-2',
        stateData: {
          journeyId: 'journey-flow-xyz',
          origin: 'Paddington',
          destination: 'Bristol Temple Meads',
          travelDate: '2024-11-25',
          departureTime: '10:15',
        },
      };

      const result = await journeyConfirmHandler(confirmContext);

      // Assert: stateData contains required fields for routing handler
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.journeyId).toBe('journey-flow-xyz');
      expect(result.stateData?.origin).toBe('Paddington');
      expect(result.stateData?.destination).toBe('Bristol Temple Meads');
      expect(result.stateData?.travelDate).toBe('2024-11-25');
      expect(result.stateData?.departureTime).toBe('10:15');
    });

    it('should complete full flow: confirm YES → routing check → ticket upload', async () => {
      /**
       * END-TO-END FLOW VERIFICATION:
       * 1. User confirms journey (YES)
       * 2. Handler transitions to AWAITING_ROUTING_CONFIRM with stateData
       * 3. Routing handler invoked (simulating FSM transition)
       * 4. Routing handler calls journey-matcher API
       * 5. User confirms routing (YES)
       * 6. Final transition to AWAITING_TICKET_UPLOAD
       *
       * This test simulates the FSM orchestration across handlers
       */

      // Step 1: User confirms journey
      const confirmContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: 'YES',
        messageSid: 'SM-flow-test-3',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
        correlationId: 'flow-test-corr-3',
        stateData: {
          journeyId: 'journey-flow-e2e',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-01',
          departureTime: '09:30',
        },
      };

      const confirmResult = await journeyConfirmHandler(confirmContext);

      // Verify transition to routing confirmation
      expect(confirmResult.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);

      // Step 2: Simulate FSM transition to routing-suggestion.handler
      // This simulates what the FSM service would do after journey-confirm completes
      const routingContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: '09:30', // Simulating journey time input (triggers routing lookup)
        messageSid: 'SM-flow-test-4',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_TIME, // routing-suggestion.handler checks this state
        correlationId: 'flow-test-corr-3',
        stateData: confirmResult.stateData, // Pass data from confirm handler
      };

      // Mock journey-matcher API response
      const scope = nock(journeyMatcherUrl)
        .get('/routes')
        .query({
          from: 'PAD',
          to: 'CDF',
          date: '2024-12-01',
          time: '09:30',
        })
        .reply(200, {
          routes: [
            {
              legs: [
                {
                  from: 'London Paddington',
                  to: 'Bristol Temple Meads',
                  departure: '09:30',
                  arrival: '11:00',
                  operator: 'GWR',
                },
                {
                  from: 'Bristol Temple Meads',
                  to: 'Cardiff Central',
                  departure: '11:15',
                  arrival: '11:45',
                  operator: 'GWR',
                },
              ],
              totalDuration: '2h 15m',
            },
          ],
        });

      const routingResult = await routingSuggestionHandler(routingContext);

      // Verify routing handler called API
      expect(scope.isDone()).toBe(true);

      // Verify routing handler transitioned to AWAITING_ROUTING_CONFIRM
      expect(routingResult.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
      expect(routingResult.response).toContain('requires a change');

      // Step 3: User confirms routing
      const routingConfirmContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: 'YES',
        messageSid: 'SM-flow-test-5',
        user: mockUser,
        currentState: FSMState.AWAITING_ROUTING_CONFIRM,
        correlationId: 'flow-test-corr-3',
        stateData: routingResult.stateData,
      };

      const finalResult = await routingSuggestionHandler(routingConfirmContext);

      // Verify final transition to ticket upload
      expect(finalResult.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      expect(finalResult.response).toContain('ticket');
    });
  });

  describe('Edge Cases: State Data Propagation', () => {
    it('should handle missing stateData fields gracefully in routing handler', async () => {
      /**
       * EDGE CASE: What happens if journey-confirm doesn't pass required fields?
       * routing-suggestion.handler should transition to ERROR state
       */

      const routingContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: '10:00',
        messageSid: 'SM-edge-test-1',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        correlationId: 'edge-test-corr-1',
        stateData: {
          // Missing journeyId, origin, destination, etc.
        },
      };

      const result = await routingSuggestionHandler(routingContext);

      // Should transition to ERROR due to missing required fields
      expect(result.nextState).toBe(FSMState.ERROR);
      expect(result.response).toContain('went wrong');
    });

    it('should handle missing stateData entirely in routing handler', async () => {
      /**
       * EDGE CASE: stateData is undefined
       */

      const routingContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: '10:00',
        messageSid: 'SM-edge-test-2',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        correlationId: 'edge-test-corr-2',
        // stateData is undefined
      };

      const result = await routingSuggestionHandler(routingContext);

      // Should transition to ERROR due to missing stateData
      expect(result.nextState).toBe(FSMState.ERROR);
      expect(result.response).toContain('went wrong');
    });
  });

  describe('Regression: Journey Confirm Handler Should NOT Bypass Routing', () => {
    it('should NOT transition directly to AWAITING_TICKET_UPLOAD from AWAITING_JOURNEY_CONFIRM', async () => {
      /**
       * REGRESSION TEST: Prevent future reintroduction of the bug
       * Verify that journey-confirm NEVER transitions directly to AWAITING_TICKET_UPLOAD
       */

      const confirmContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: 'YES',
        messageSid: 'SM-regression-test',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
        correlationId: 'regression-test-corr',
        stateData: {
          journeyId: 'journey-regression-test',
          origin: 'PAD',
          destination: 'BRI',
          travelDate: '2024-11-30',
          departureTime: '14:00',
        },
      };

      const result = await journeyConfirmHandler(confirmContext);

      // CRITICAL ASSERTION: Should NOT be AWAITING_TICKET_UPLOAD
      expect(result.nextState).not.toBe(FSMState.AWAITING_TICKET_UPLOAD);

      // Should be AWAITING_ROUTING_CONFIRM instead
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
    });
  });
});
