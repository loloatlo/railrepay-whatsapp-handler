/**
 * TD-WHATSAPP-034: Integration Test - Journey Flow with Routing
 *
 * UPDATED WORKFLOW: API call moved to journey-time.handler
 *
 * This test verifies:
 * 1. journey-time.handler calls journey-matcher API and presents routes
 * 2. journey-confirm.handler handles YES → AWAITING_TICKET_UPLOAD (route already matched)
 * 3. Journey data flows through state transitions correctly
 *
 * Per ADR-014: Tests written BEFORE implementation
 *
 * WORKFLOW:
 * AWAITING_JOURNEY_TIME + time input → journey-time.handler calls API → shows matched route
 * AWAITING_JOURNEY_CONFIRM + "YES" → journey-confirm.handler → AWAITING_TICKET_UPLOAD
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FSMState } from '../../src/services/fsm.service';
import type { HandlerContext } from '../../src/handlers';
import type { User } from '../../src/db/types';
import nock from 'nock';

// Use vi.hoisted() for mock logger
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: () => mockLogger,
}));

// Import handlers after mocks
import { journeyTimeHandler } from '../../src/handlers/journey-time.handler';
import { journeyConfirmHandler } from '../../src/handlers/journey-confirm.handler';

describe('Journey Flow Integration: Time → Confirm → Ticket Upload', () => {
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

    process.env.JOURNEY_MATCHER_URL = journeyMatcherUrl;
    nock.cleanAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.JOURNEY_MATCHER_URL;
    nock.cleanAll();
  });

  describe('Direct Route Flow', () => {
    it('should complete full flow: enter time → API call → show route → confirm YES → ticket upload', async () => {
      // Step 1: User provides journey time
      const timeContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: '08:30',
        messageSid: 'SM-flow-test-1',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        correlationId: 'flow-test-corr-1',
        stateData: {
          travelDate: '2026-01-24',
          journeyId: 'journey-flow-direct',
          origin: 'AGV',  // CRS code
          destination: 'HFD',  // CRS code
          originName: 'Abergavenny',
          destinationName: 'Hereford',
        },
      };

      // Mock journey-matcher API for direct route
      const scope = nock(journeyMatcherUrl)
        .get('/routes')
        .query({
          from: 'AGV',
          to: 'HFD',
          date: '2026-01-24',
          time: '08:30',
        })
        .reply(200, {
          routes: [
            {
              legs: [
                {
                  from: 'Abergavenny',
                  to: 'Hereford',
                  departure: '08:31',
                  arrival: '09:00',
                  operator: 'Transport for Wales',
                },
              ],
              totalDuration: '29m',
              isDirect: true,
            },
          ],
        });

      const timeResult = await journeyTimeHandler(timeContext);

      // Verify API was called
      expect(scope.isDone()).toBe(true);

      // Verify response shows matched route
      expect(timeResult.response).toContain('08:31');
      expect(timeResult.response).toContain('Abergavenny');
      expect(timeResult.response).toContain('YES');
      expect(timeResult.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);

      // Verify stateData contains matched route
      expect(timeResult.stateData?.matchedRoute).toBeDefined();
      expect(timeResult.stateData?.isDirect).toBe(true);

      // Step 2: User confirms with YES
      const confirmContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: 'YES',
        messageSid: 'SM-flow-test-2',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
        correlationId: 'flow-test-corr-1',
        stateData: timeResult.stateData,  // Pass state from time handler
      };

      const confirmResult = await journeyConfirmHandler(confirmContext);

      // Verify transition to ticket upload
      expect(confirmResult.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      expect(confirmResult.response).toContain('confirmed');
      expect(confirmResult.response).toContain('ticket');

      // Verify confirmed route is in stateData
      expect(confirmResult.stateData?.confirmedRoute).toBeDefined();
      expect(confirmResult.stateData?.journeyConfirmed).toBe(true);
    });
  });

  describe('Interchange Route Flow', () => {
    it('should show interchange details and complete flow', async () => {
      // Step 1: User provides journey time for interchange route
      const timeContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: '08:30',
        messageSid: 'SM-flow-test-3',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        correlationId: 'flow-test-corr-2',
        stateData: {
          travelDate: '2026-01-24',
          journeyId: 'journey-flow-interchange',
          origin: 'AGV',
          destination: 'BHM',  // Birmingham
          originName: 'Abergavenny',
          destinationName: 'Birmingham New Street',
        },
      };

      // Mock journey-matcher API for interchange route
      const scope = nock(journeyMatcherUrl)
        .get('/routes')
        .query({
          from: 'AGV',
          to: 'BHM',
          date: '2026-01-24',
          time: '08:30',
        })
        .reply(200, {
          routes: [
            {
              legs: [
                {
                  from: 'Abergavenny',
                  to: 'Hereford',
                  departure: '08:31',
                  arrival: '09:00',
                  operator: 'Transport for Wales',
                },
                {
                  from: 'Hereford',
                  to: 'Birmingham New Street',
                  departure: '09:40',
                  arrival: '10:30',
                  operator: 'Transport for Wales',
                },
              ],
              totalDuration: '1h 59m',
              isDirect: false,
              interchangeStation: 'Hereford',
            },
          ],
        });

      const timeResult = await journeyTimeHandler(timeContext);

      // Verify API was called
      expect(scope.isDone()).toBe(true);

      // Verify response shows interchange details
      expect(timeResult.response).toContain('change at Hereford');
      expect(timeResult.response).toContain('Leg 1');
      expect(timeResult.response).toContain('Leg 2');
      expect(timeResult.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);

      // Verify stateData contains interchange info
      expect(timeResult.stateData?.isDirect).toBe(false);
      expect(timeResult.stateData?.interchangeStation).toBe('Hereford');

      // Step 2: User confirms with YES
      const confirmContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: 'YES',
        messageSid: 'SM-flow-test-4',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
        correlationId: 'flow-test-corr-2',
        stateData: timeResult.stateData,
      };

      const confirmResult = await journeyConfirmHandler(confirmContext);

      // Verify transition to ticket upload
      expect(confirmResult.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      expect(confirmResult.stateData?.journeyConfirmed).toBe(true);
    });
  });

  describe('User Rejects Route (NO)', () => {
    /**
     * AC-6: Integration test updated for TD-WHATSAPP-056
     * CHANGED BEHAVIOR: NO path now depends on allRoutes.length
     * - allRoutes.length === 1 → Stay in AWAITING_JOURNEY_CONFIRM (AC-1)
     * - allRoutes.length > 1 → Transition to AWAITING_ROUTING_ALTERNATIVE (AC-2)
     */

    it('should stay in AWAITING_JOURNEY_CONFIRM when only 1 route available (AC-1 integration test)', async () => {
      // AC-6: Integration test for single-route NO path (TD-WHATSAPP-056 AC-1)
      // SCENARIO: journey-matcher returned only 1 route, user says NO

      const timeContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: '10:00',
        messageSid: 'SM-flow-test-5',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        correlationId: 'flow-test-corr-3',
        stateData: {
          travelDate: '2026-01-24',
          journeyId: 'journey-flow-reject',
          origin: 'AGV',
          destination: 'HFD',
          originName: 'Abergavenny',
          destinationName: 'Hereford',
        },
      };

      nock(journeyMatcherUrl)
        .get('/routes')
        .query(true)
        .reply(200, {
          routes: [{
            legs: [{ from: 'A', to: 'B', departure: '10:03', arrival: '10:30', operator: 'TfW' }],
            isDirect: true,
          }], // Only 1 route returned
        });

      const timeResult = await journeyTimeHandler(timeContext);
      expect(timeResult.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);

      // Step 2: User rejects with NO
      const confirmContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: 'NO',
        messageSid: 'SM-flow-test-6',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
        correlationId: 'flow-test-corr-3',
        stateData: timeResult.stateData,
      };

      const confirmResult = await journeyConfirmHandler(confirmContext);

      // AC-1: Should stay in AWAITING_JOURNEY_CONFIRM (single-route scenario)
      expect(confirmResult.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
      expect(confirmResult.response).toContain('only');

      // State data should be preserved (origin, destination, etc.)
      expect(confirmResult.stateData?.origin).toBe('AGV');
    });

    it('should transition to AWAITING_ROUTING_ALTERNATIVE when 2+ routes available (AC-2 integration test)', async () => {
      // AC-6: Integration test for multi-route NO path (TD-WHATSAPP-056 AC-2)
      // SCENARIO: journey-matcher returned 4 routes, user says NO

      const timeContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: '10:00',
        messageSid: 'SM-flow-test-7',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        correlationId: 'flow-test-corr-4',
        stateData: {
          travelDate: '2026-01-24',
          journeyId: 'journey-flow-multi-reject',
          origin: 'AGV',
          destination: 'HFD',
          originName: 'Abergavenny',
          destinationName: 'Hereford',
        },
      };

      nock(journeyMatcherUrl)
        .get('/routes')
        .query(true)
        .reply(200, {
          routes: [
            {
              legs: [{ from: 'AGV', to: 'HFD', departure: '10:03', arrival: '10:30', operator: 'TfW' }],
              isDirect: true,
            },
            {
              legs: [{ from: 'AGV', to: 'HFD', departure: '11:03', arrival: '11:30', operator: 'TfW' }],
              isDirect: true,
            },
            {
              legs: [{ from: 'AGV', to: 'HFD', departure: '12:03', arrival: '12:30', operator: 'TfW' }],
              isDirect: true,
            },
            {
              legs: [{ from: 'AGV', to: 'HFD', departure: '13:03', arrival: '13:30', operator: 'TfW' }],
              isDirect: true,
            },
          ], // 4 routes returned
        });

      const timeResult = await journeyTimeHandler(timeContext);
      expect(timeResult.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);

      // Step 2: User rejects with NO
      const confirmContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: 'NO',
        messageSid: 'SM-flow-test-8',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
        correlationId: 'flow-test-corr-4',
        stateData: timeResult.stateData,
      };

      const confirmResult = await journeyConfirmHandler(confirmContext);

      // AC-2: Should transition to AWAITING_ROUTING_ALTERNATIVE (multi-route scenario)
      expect(confirmResult.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
      expect(confirmResult.response).toContain('alternative');

      // AC-2: Should display Set 1 alternatives (routes 1, 2, 3 from allRoutes)
      expect(confirmResult.response).toContain('11:03'); // Second route
      expect(confirmResult.response).toContain('12:03'); // Third route
      expect(confirmResult.response).toContain('13:03'); // Fourth route

      // AC-2: currentAlternatives populated in stateData
      expect(confirmResult.stateData?.currentAlternatives).toBeDefined();
      expect(confirmResult.stateData?.currentAlternatives?.length).toBe(3);

      // State data should be preserved
      expect(confirmResult.stateData?.origin).toBe('AGV');
      expect(confirmResult.stateData?.alternativeCount).toBe(1);
    });
  });

  describe('API Error Handling', () => {
    it('should handle API timeout and allow retry', async () => {
      const timeContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: '14:00',
        messageSid: 'SM-error-test-1',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        correlationId: 'error-test-corr-1',
        stateData: {
          travelDate: '2026-01-24',
          journeyId: 'journey-error-test',
          origin: 'AGV',
          destination: 'HFD',
        },
      };

      // Mock timeout
      nock(journeyMatcherUrl)
        .get('/routes')
        .query(true)
        .replyWithError({ code: 'ECONNABORTED', message: 'timeout' });

      const result = await journeyTimeHandler(timeContext);

      // Should stay in same state for retry
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
      expect(result.response).toContain('taking longer');
    });

    it('should handle no routes found', async () => {
      const timeContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: '03:00',  // Very early, no trains
        messageSid: 'SM-error-test-2',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        correlationId: 'error-test-corr-2',
        stateData: {
          travelDate: '2026-01-24',
          journeyId: 'journey-no-routes',
          origin: 'AGV',
          destination: 'HFD',
        },
      };

      nock(journeyMatcherUrl)
        .get('/routes')
        .query(true)
        .reply(200, { routes: [] });

      const result = await journeyTimeHandler(timeContext);

      // Should stay in same state
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
      expect(result.response).toContain('couldn\'t find');
    });
  });

  describe('State Data Preservation', () => {
    it('should preserve all journey data throughout the flow', async () => {
      const initialStateData = {
        travelDate: '2026-01-24',
        journeyId: 'journey-preserve-test',
        origin: 'AGV',
        destination: 'HFD',
        originName: 'Abergavenny',
        destinationName: 'Hereford',
      };

      const timeContext: HandlerContext = {
        phoneNumber: '+447700900888',
        messageBody: '09:00',
        messageSid: 'SM-preserve-test',
        user: mockUser,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        correlationId: 'preserve-test-corr',
        stateData: initialStateData,
      };

      nock(journeyMatcherUrl)
        .get('/routes')
        .query(true)
        .reply(200, {
          routes: [{
            legs: [{ from: 'A', to: 'B', departure: '09:03', arrival: '09:30', operator: 'TfW' }],
            isDirect: true,
          }],
        });

      const timeResult = await journeyTimeHandler(timeContext);

      // All initial fields should be preserved
      expect(timeResult.stateData?.travelDate).toBe('2026-01-24');
      expect(timeResult.stateData?.journeyId).toBe('journey-preserve-test');
      expect(timeResult.stateData?.origin).toBe('AGV');
      expect(timeResult.stateData?.destination).toBe('HFD');
      expect(timeResult.stateData?.originName).toBe('Abergavenny');

      // New fields should be added
      expect(timeResult.stateData?.departureTime).toBe('09:00');
      expect(timeResult.stateData?.matchedRoute).toBeDefined();

      // Confirm step
      const confirmContext: HandlerContext = {
        ...timeContext,
        messageBody: 'YES',
        currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
        stateData: timeResult.stateData,
      };

      const confirmResult = await journeyConfirmHandler(confirmContext);

      // All fields still preserved
      expect(confirmResult.stateData?.travelDate).toBe('2026-01-24');
      expect(confirmResult.stateData?.journeyId).toBe('journey-preserve-test');
      expect(confirmResult.stateData?.confirmedRoute).toBeDefined();
    });
  });
});
