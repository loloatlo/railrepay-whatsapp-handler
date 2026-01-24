/**
 * TD-WHATSAPP-028: Routing Suggestion Handler - CORRECTED API Integration Tests
 *
 * CONTEXT: Original handler calls GET /journeys/:id/routes (WRONG endpoint).
 * This test specifies the CORRECT behavior: GET /routes?from=...&to=...&date=...&time=...
 *
 * TD CONTEXT: whatsapp-handler SHOULD call GET /routes with query params, not /journeys/:id/routes
 * REQUIRED FIX: Update routing-suggestion.handler.ts to call the correct endpoint
 *
 * Per ADR-014: Tests written BEFORE implementation changes
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 * Per Section 6.1.10: Mocked endpoint verification required
 *
 * These tests will FAIL until Blake:
 * 1. Implements GET /routes endpoint in journey-matcher (creates src/api/routes.ts)
 * 2. Updates routing-suggestion.handler.ts to call GET /routes instead of GET /journeys/:id/routes
 * 3. Extracts origin/destination/date/time from stateData to pass as query params
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';
import axios from 'axios';
import { routingSuggestionHandler } from '../../../src/handlers/routing-suggestion.handler';

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

// Create axios mock spy to verify REAL HTTP calls are made
vi.spyOn(axios, 'get');

describe('TD-WHATSAPP-028: Routing Suggestion Handler - Corrected Journey-Matcher Integration', () => {
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

    // Setup environment variable (per Section 6.2.1)
    process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.test:3001';

    mockContext = {
      phoneNumber: '+447700900123',
      messageBody: 'YES',
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.AWAITING_ROUTING_CONFIRM,
      correlationId: 'test-corr-id',
      stateData: {
        journeyId: 'journey-456',
        origin: 'PAD',
        destination: 'CDF',
        travelDate: '2024-12-20',
        departureTime: '10:00',
      },
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.JOURNEY_MATCHER_URL;
  });

  describe('AC-1: CORRECTED API call to GET /routes with query parameters', () => {
    it('should call GET /routes?from=...&to=...&date=...&time=... instead of GET /journeys/:id/routes', async () => {
      /**
       * Verified: journey-matcher WILL expose GET /routes endpoint (Blake will create)
       * Current handler calls WRONG endpoint: GET /journeys/:id/routes
       * Correct endpoint: GET /routes with query params
       *
       * This test verifies the CORRECTED behavior.
       */

      // Mock successful response from journey-matcher GET /routes
      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: {
          routes: [
            {
              legs: [
                {
                  from: 'London Paddington',
                  to: 'Bristol Temple Meads',
                  departure: '10:00',
                  arrival: '11:30',
                  operator: 'GWR',
                },
                {
                  from: 'Bristol Temple Meads',
                  to: 'Cardiff Central',
                  departure: '11:45',
                  arrival: '12:15',
                  operator: 'GWR',
                },
              ],
              totalDuration: '2h 15m',
            },
          ],
        },
      });

      // Act: Trigger routing suggestion from AWAITING_JOURNEY_TIME state
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

      // Assert: axios.get called with CORRECT endpoint
      expect(axios.get).toHaveBeenCalledWith(
        'http://journey-matcher.test:3001/routes?from=PAD&to=CDF&date=2024-12-20&time=10:00',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'test-corr-id',
          }),
        })
      );

      // Assert: Response contains route information
      expect(result.response).toContain('requires a change');
      expect(result.response).toContain('London Paddington');
      expect(result.response).toContain('Cardiff Central');
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
    });

    it('should extract origin/destination/date/time from stateData (not from journeyId)', async () => {
      /**
       * CURRENT WRONG BEHAVIOR: Handler uses journeyId to call GET /journeys/:id/routes
       * CORRECT BEHAVIOR: Handler should extract origin/destination/date/time from stateData
       * and pass as query params to GET /routes
       */

      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: {
          routes: [
            {
              legs: [
                {
                  from: 'London Kings Cross',
                  to: 'Edinburgh Waverley',
                  departure: '10:00',
                  arrival: '14:30',
                  operator: 'LNER',
                },
              ],
              totalDuration: '4h 30m',
            },
          ],
        },
      });

      await routingSuggestionHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        messageBody: '10:00',
        stateData: {
          journeyId: 'journey-789',
          origin: 'KGX',
          destination: 'EDB',
          travelDate: '2024-12-25',
          departureTime: '10:00',
        },
      });

      // Assert: Query params constructed from stateData, NOT journeyId
      expect(axios.get).toHaveBeenCalledWith(
        'http://journey-matcher.test:3001/routes?from=KGX&to=EDB&date=2024-12-25&time=10:00',
        expect.any(Object)
      );
    });
  });

  describe('AC-2: Handle missing stateData fields gracefully', () => {
    it('should return error when origin is missing from stateData', async () => {
      const result = await routingSuggestionHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        messageBody: '10:00',
        stateData: {
          journeyId: 'journey-456',
          // origin: missing
          destination: 'CDF',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        },
      });

      expect(result.response).toContain('wrong');
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should return error when destination is missing from stateData', async () => {
      const result = await routingSuggestionHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        messageBody: '10:00',
        stateData: {
          journeyId: 'journey-456',
          origin: 'PAD',
          // destination: missing
          travelDate: '2024-12-20',
          departureTime: '10:00',
        },
      });

      expect(result.response).toContain('wrong');
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should return error when travelDate is missing from stateData', async () => {
      const result = await routingSuggestionHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        messageBody: '10:00',
        stateData: {
          journeyId: 'journey-456',
          origin: 'PAD',
          destination: 'CDF',
          // travelDate: missing
          departureTime: '10:00',
        },
      });

      expect(result.response).toContain('wrong');
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should return error when departureTime is missing from stateData', async () => {
      const result = await routingSuggestionHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        messageBody: '10:00',
        stateData: {
          journeyId: 'journey-456',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-20',
          // departureTime: missing
        },
      });

      expect(result.response).toContain('wrong');
      expect(result.nextState).toBe(FSMState.ERROR);
    });
  });

  describe('AC-3: Error handling from journey-matcher /routes endpoint', () => {
    it('should handle 400 error (missing query params) from journey-matcher', async () => {
      vi.mocked(axios.get).mockRejectedValue({
        response: { status: 400, data: { error: 'Missing required parameter: from' } },
        message: 'Request failed with status code 400',
      });

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

      expect(result.response).toContain('unavailable');
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should handle 404 error (no routes found) from journey-matcher', async () => {
      vi.mocked(axios.get).mockRejectedValue({
        response: { status: 404, data: { error: 'No routes found' } },
        message: 'Request failed with status code 404',
      });

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

      expect(result.response).toContain('unable to find any routes');
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should handle 500 error (OTP unavailable) from journey-matcher', async () => {
      vi.mocked(axios.get).mockRejectedValue({
        response: { status: 500, data: { error: 'OTP service unavailable' } },
        message: 'Request failed with status code 500',
      });

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

      expect(result.response).toContain('temporarily unavailable');
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should handle network timeout errors', async () => {
      vi.mocked(axios.get).mockRejectedValue({
        code: 'ECONNABORTED',
        message: 'timeout of 5000ms exceeded',
      });

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

      expect(result.response).toContain('unavailable');
      expect(result.nextState).toBe(FSMState.ERROR);
    });
  });

  describe('AC-4: Correlation ID propagation to journey-matcher', () => {
    it('should propagate X-Correlation-ID header to journey-matcher API', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: {
          routes: [
            {
              legs: [
                {
                  from: 'London Paddington',
                  to: 'Cardiff Central',
                  departure: '10:00',
                  arrival: '12:15',
                  operator: 'GWR',
                },
              ],
              totalDuration: '2h 15m',
            },
          ],
        },
      });

      const correlationId = 'unique-correlation-456';
      await routingSuggestionHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_JOURNEY_TIME,
        messageBody: '10:00',
        correlationId,
        stateData: {
          journeyId: 'journey-456',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        },
      });

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': correlationId,
          }),
        })
      );
    });
  });

  describe('AC-5: Response parsing and state transition', () => {
    it('should parse route alternatives and display most likely route', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: {
          routes: [
            {
              legs: [
                {
                  from: 'London Paddington',
                  to: 'Bristol Temple Meads',
                  departure: '10:00',
                  arrival: '11:30',
                  operator: 'GWR',
                },
                {
                  from: 'Bristol Temple Meads',
                  to: 'Cardiff Central',
                  departure: '11:45',
                  arrival: '12:15',
                  operator: 'GWR',
                },
              ],
              totalDuration: '2h 15m',
            },
            {
              legs: [
                {
                  from: 'London Paddington',
                  to: 'Reading',
                  departure: '10:05',
                  arrival: '10:35',
                  operator: 'GWR',
                },
                {
                  from: 'Reading',
                  to: 'Cardiff Central',
                  departure: '10:50',
                  arrival: '12:20',
                  operator: 'GWR',
                },
              ],
              totalDuration: '2h 15m',
            },
          ],
        },
      });

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

      // Should display ONLY the first (most likely) route
      expect(result.response).toContain('Bristol Temple Meads');
      expect(result.response).toContain('10:00');
      expect(result.response).toContain('11:30');
      expect(result.response).toContain('11:45');
      expect(result.response).toContain('12:15');
      expect(result.response).toContain('2h 15m');

      // Should NOT display second route (alternatives shown only if user rejects)
      expect(result.response).not.toContain('Reading');

      // Should transition to AWAITING_ROUTING_CONFIRM
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);

      // Should store ALL routes in stateData for later (if user rejects)
      expect(result.stateData?.suggestedRoute).toBeDefined();
      expect(result.stateData?.suggestedRoute.legs).toHaveLength(2);
    });
  });
});
