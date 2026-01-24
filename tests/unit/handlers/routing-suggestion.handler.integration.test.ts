/**
 * TD-WHATSAPP-028: Journey-Matcher Integration Tests (Real HTTP Client)
 *
 * TECHNICAL DEBT CONTEXT:
 * - Current implementation uses hardcoded mock routes in routing-suggestion.handler.ts
 * - REQUIRED FIX: Replace with real HTTP client call to journey-matcher API
 * - Add JOURNEY_MATCHER_URL environment variable
 * - Handle journey-matcher error responses
 *
 * ACCEPTANCE CRITERIA TO TEST:
 * - AC-1: routing-suggestion.handler.ts makes HTTP call to journey-matcher API
 * - AC-2: Route suggestions display data from journey-matcher response
 * - AC-3: Handler returns graceful error message if journey-matcher unavailable
 * - AC-4: JOURNEY_MATCHER_URL environment variable documented and configured
 * - AC-5: Correlation ID propagated to journey-matcher requests
 *
 * PER ADR-014 (TDD): These tests written FIRST, before Blake implements the fix.
 * Tests MUST FAIL initially, proving the gap exists.
 *
 * PER JESSIE GUIDELINES (Phase 3.1):
 * - Behavior-focused: Test WHAT the system should do, not HOW
 * - Interface-based mocking: Mock HTTP client, not internal functions
 * - Runnable from Day 1: All assertions are completable by Blake
 * - No placeholder assertions
 * - Standard Vitest matchers only
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';
import { routingSuggestionHandler } from '../../../src/handlers/routing-suggestion.handler';
import axios from 'axios';

// Mock axios for HTTP client testing
vi.mock('axios');

// Create shared logger instance OUTSIDE the factory function
// This ensures all calls to createLogger() return the SAME instance
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

// Mock winston logger to prevent "mockLogger is not defined" errors
vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

describe('TD-WHATSAPP-028: Journey-Matcher Integration (Real HTTP Client)', () => {
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
      currentState: FSMState.AWAITING_JOURNEY_TIME,
      correlationId: 'test-corr-id-12345',
      // Include journeyId in stateData per Jessie guidelines
      stateData: {
        journeyId: 'journey-456',
        origin: 'PAD',
        destination: 'CDF',
        travelDate: '2025-01-24',
        departureTime: '10:00',
      },
    };

    // Setup environment variable (per Section 6.2.1)
    process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.test:3001';

    // Clear all mocks between tests
    vi.clearAllMocks();

    // Clear shared logger call history
    sharedLogger.info.mockClear();
    sharedLogger.error.mockClear();
    sharedLogger.warn.mockClear();
    sharedLogger.debug.mockClear();
  });

  afterEach(() => {
    delete process.env.JOURNEY_MATCHER_URL;
    vi.restoreAllMocks();
  });

  describe('AC-1: HTTP Call to Journey-Matcher API', () => {
    it('should make GET request to journey-matcher /routes with query parameters', async () => {
      /**
       * BEHAVIOR: Handler must call journey-matcher API to fetch real routes
       * Per TD-WHATSAPP-028: Uses GET /routes?from=...&to=...&date=...&time=...
       * Expected: Handler makes HTTP GET with query params from stateData
       */
      const mockRoutes = {
        routes: [
          {
            legs: [
              { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
              { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '11:45', arrival: '12:15' },
            ],
            totalDuration: '2h 15m',
          },
        ],
      };

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: mockRoutes,
      });

      await routingSuggestionHandler(mockContext);

      // ASSERT: HTTP GET called with correct URL and query params
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledWith(
        'http://journey-matcher.test:3001/routes?from=PAD&to=CDF&date=2025-01-24&time=10:00',
        expect.any(Object)
      );
    });

    it('should use JOURNEY_MATCHER_URL environment variable to construct API URL', async () => {
      /**
       * BEHAVIOR: URL must be configurable via environment variable
       * Per TD-WHATSAPP-028: Uses GET /routes with query parameters
       * Expected: process.env.JOURNEY_MATCHER_URL used as base URL
       */
      process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.railway.internal:3001';

      const mockRoutes = {
        routes: [
          {
            legs: [
              { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
              { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '11:45', arrival: '12:15' },
            ],
            totalDuration: '2h 15m',
          },
        ],
      };

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: mockRoutes,
      });

      await routingSuggestionHandler(mockContext);

      // ASSERT: Full URL includes JOURNEY_MATCHER_URL base with query params
      expect(axios.get).toHaveBeenCalledWith(
        'http://journey-matcher.railway.internal:3001/routes?from=PAD&to=CDF&date=2025-01-24&time=10:00',
        expect.any(Object)
      );

      // Cleanup (will also be cleaned in afterEach, but explicit here)
      delete process.env.JOURNEY_MATCHER_URL;
    });

    it('should extract origin/destination/date/time from context stateData for API call', async () => {
      /**
       * BEHAVIOR: Query params must come from FSM state data, not message body
       * Per TD-WHATSAPP-028: Uses from/to/date/time query params from stateData
       * Expected: Read from ctx.stateData
       */
      const contextWithDifferentData = {
        ...mockContext,
        stateData: {
          journeyId: 'journey-999',
          origin: 'KGX',
          destination: 'EDB',
          travelDate: '2025-02-14',
          departureTime: '14:30',
        },
      };

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: {
          routes: [
            {
              legs: [
                { from: 'KGX', to: 'EDB', operator: 'LNER', departure: '14:30', arrival: '19:00' },
              ],
              totalDuration: '4h 30m',
            },
          ],
        },
      });

      await routingSuggestionHandler(contextWithDifferentData);

      // ASSERT: API called with query params from stateData
      expect(axios.get).toHaveBeenCalledWith(
        'http://journey-matcher.test:3001/routes?from=KGX&to=EDB&date=2025-02-14&time=14:30',
        expect.any(Object)
      );
    });
  });

  describe('AC-2: Display Data from Journey-Matcher Response', () => {
    it('should display route legs from journey-matcher response in message', async () => {
      /**
       * BEHAVIOR: Response message must contain route data from API, not hardcoded data
       * Currently: Uses hardcoded PAD → BRI → CDF route
       * Expected: Displays actual route from journey-matcher API response
       */
      const mockApiRoutes = {
        routes: [
          {
            legs: [
              { from: 'PAD', to: 'RDG', operator: 'GWR', departure: '09:00', arrival: '09:30' },
              { from: 'RDG', to: 'CDF', operator: 'GWR', departure: '10:00', arrival: '12:00' },
            ],
            totalDuration: '3h 0m',
          },
        ],
      };

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: mockApiRoutes,
      });

      const result = await routingSuggestionHandler(mockContext);

      // ASSERT: Response contains data from API (NOT hardcoded data)
      expect(result.response).toContain('RDG'); // Different from hardcoded 'BRI'
      expect(result.response).toContain('09:00'); // Different from hardcoded '10:00'
      expect(result.response).toContain('3h 0m'); // Different from hardcoded '2h 15m'
    });

    it('should display all route legs when journey has multiple interchanges', async () => {
      /**
       * BEHAVIOR: Handler must support N-leg journeys, not just 2-leg
       * Currently: Hardcoded 2-leg display
       * Expected: Dynamic display based on API response
       */
      const mockComplexRoute = {
        routes: [
          {
            legs: [
              { from: 'PAD', to: 'RDG', operator: 'GWR', departure: '08:00', arrival: '08:30' },
              { from: 'RDG', to: 'BRI', operator: 'GWR', departure: '08:45', arrival: '09:45' },
              { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '10:00', arrival: '10:45' },
            ],
            totalDuration: '2h 45m',
          },
        ],
      };

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: mockComplexRoute,
      });

      const result = await routingSuggestionHandler(mockContext);

      // ASSERT: All 3 legs displayed
      expect(result.response).toContain('PAD');
      expect(result.response).toContain('RDG');
      expect(result.response).toContain('BRI');
      expect(result.response).toContain('CDF');
      expect(result.response).toContain('Leg 1');
      expect(result.response).toContain('Leg 2');
      expect(result.response).toContain('Leg 3');
    });

    it('should store journey route data in stateData for later confirmation', async () => {
      /**
       * BEHAVIOR: Route data must be stored in FSM state for user confirmation
       * Currently: Hardcoded suggestedRoute stored
       * Expected: API response stored in stateData
       */
      const mockApiRoutes = {
        routes: [
          {
            legs: [
              { from: 'PAD', to: 'SWA', operator: 'GWR', departure: '11:00', arrival: '14:00' },
              { from: 'SWA', to: 'CDF', operator: 'TfW', departure: '14:15', arrival: '15:00' },
            ],
            totalDuration: '4h 0m',
          },
        ],
      };

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: mockApiRoutes,
      });

      const result = await routingSuggestionHandler(mockContext);

      // ASSERT: stateData contains route from API response
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.suggestedRoute).toBeDefined();
      expect(result.stateData?.suggestedRoute?.legs).toHaveLength(2);
      expect(result.stateData?.suggestedRoute?.legs?.[0]?.from).toBe('PAD');
      expect(result.stateData?.suggestedRoute?.legs?.[0]?.to).toBe('SWA'); // Different from hardcoded 'BRI'
      expect(result.stateData?.suggestedRoute?.totalDuration).toBe('4h 0m');
    });
  });

  describe('AC-3: Graceful Error Handling for Journey-Matcher Unavailability', () => {
    it('should return user-friendly error message when journey-matcher returns 404', async () => {
      /**
       * BEHAVIOR: 404 from journey-matcher means journey not found
       * Currently: No error handling
       * Expected: User-friendly message, transition to ERROR state
       */
      vi.mocked(axios.get).mockRejectedValueOnce({
        response: {
          status: 404,
          data: { error: 'Journey not found' },
        },
        isAxiosError: true,
      });

      const result = await routingSuggestionHandler(mockContext);

      // ASSERT: Error message returned to user
      expect(result.response).toContain('unable to find');
      expect(result.response).toContain('journey');
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should return user-friendly error message when journey-matcher times out', async () => {
      /**
       * BEHAVIOR: Network timeout should not crash handler
       * Currently: No timeout handling
       * Expected: Graceful degradation with user-friendly message
       */
      vi.mocked(axios.get).mockRejectedValueOnce({
        code: 'ECONNABORTED',
        message: 'timeout of 5000ms exceeded',
        isAxiosError: true,
      });

      const result = await routingSuggestionHandler(mockContext);

      // ASSERT: Timeout handled gracefully
      expect(result.response).toContain('service');
      expect(result.response).toContain('unavailable');
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should return user-friendly error message when journey-matcher returns 500', async () => {
      /**
       * BEHAVIOR: Internal server error from journey-matcher
       * Currently: No error handling
       * Expected: Generic error message to user, do not expose internals
       */
      vi.mocked(axios.get).mockRejectedValueOnce({
        response: {
          status: 500,
          data: { error: 'Internal server error' },
        },
        isAxiosError: true,
      });

      const result = await routingSuggestionHandler(mockContext);

      // ASSERT: Generic error message (do not expose 500 to user)
      expect(result.response).toContain('temporarily unavailable');
      expect(result.response).not.toContain('500'); // Do not expose HTTP status codes
      expect(result.response).not.toContain('Internal server error'); // Do not expose internals
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should log error details with correlation ID when journey-matcher fails', async () => {
      /**
       * BEHAVIOR: Errors must be logged with correlation ID for debugging
       * Currently: No logging
       * Expected: Winston logger called with error details and correlationId
       */
      vi.mocked(axios.get).mockRejectedValueOnce({
        response: {
          status: 503,
          data: { error: 'Service unavailable' },
        },
        isAxiosError: true,
      });

      await routingSuggestionHandler(mockContext);

      // ASSERT: Error logged with correlation ID
      // Note: This assertion may need adjustment based on actual logger implementation
      // Blake will implement logging that includes correlationId and error details
      expect(sharedLogger.error).toHaveBeenCalled();
    });
  });

  describe('AC-4: JOURNEY_MATCHER_URL Environment Variable', () => {
    it('should throw error when JOURNEY_MATCHER_URL is not configured', async () => {
      /**
       * BEHAVIOR: Service must fail fast if JOURNEY_MATCHER_URL not set
       * Currently: No environment variable used
       * Expected: Clear error message on startup or first API call
       */
      delete process.env.JOURNEY_MATCHER_URL;

      // ASSERT: Error thrown when env var missing
      await expect(routingSuggestionHandler(mockContext)).rejects.toThrow(
        /JOURNEY_MATCHER_URL.*not configured/i
      );
    });

    it('should use JOURNEY_MATCHER_URL from environment for all API calls', async () => {
      /**
       * BEHAVIOR: All calls to journey-matcher must use configured base URL
       * Currently: No configuration
       * Expected: Single source of truth for base URL
       */
      process.env.JOURNEY_MATCHER_URL = 'https://journey-matcher.production.railrepay.com';

      const mockRoutes = {
        routes: [
          {
            legs: [
              { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
            ],
            totalDuration: '1h 30m',
          },
        ],
      };

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: mockRoutes,
      });

      await routingSuggestionHandler(mockContext);

      // ASSERT: Production URL used with query params
      expect(axios.get).toHaveBeenCalledWith(
        'https://journey-matcher.production.railrepay.com/routes?from=PAD&to=CDF&date=2025-01-24&time=10:00',
        expect.any(Object)
      );

      // Cleanup
      delete process.env.JOURNEY_MATCHER_URL;
    });
  });

  describe('AC-5: Correlation ID Propagation', () => {
    it('should include X-Correlation-ID header in journey-matcher request', async () => {
      /**
       * BEHAVIOR: Correlation ID must propagate to downstream services per ADR-002
       * Currently: No correlation ID propagation
       * Expected: X-Correlation-ID header included in HTTP request
       */
      process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.railway.internal:3001';

      const mockRoutes = {
        routes: [
          {
            legs: [
              { from: 'PAD', to: 'CDF', operator: 'GWR', departure: '10:00', arrival: '12:00' },
            ],
            totalDuration: '2h 0m',
          },
        ],
      };

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: mockRoutes,
      });

      await routingSuggestionHandler(mockContext);

      // ASSERT: X-Correlation-ID header included
      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'test-corr-id-12345',
          }),
        })
      );

      // Cleanup
      delete process.env.JOURNEY_MATCHER_URL;
    });

    it('should propagate unique correlation ID for each request', async () => {
      /**
       * BEHAVIOR: Different requests must have different correlation IDs
       * Currently: No correlation ID handling
       * Expected: Each request uses its own correlationId from context
       */
      process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.railway.internal:3001';

      const differentContext = {
        ...mockContext,
        correlationId: 'different-corr-id-99999',
      };

      const mockRoutes = {
        routes: [
          {
            legs: [
              { from: 'PAD', to: 'CDF', operator: 'GWR', departure: '10:00', arrival: '12:00' },
            ],
            totalDuration: '2h 0m',
          },
        ],
      };

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: mockRoutes,
      });

      await routingSuggestionHandler(differentContext);

      // ASSERT: Different correlation ID used
      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'different-corr-id-99999',
          }),
        })
      );

      // Cleanup
      delete process.env.JOURNEY_MATCHER_URL;
    });
  });

  describe('Integration: Full Journey-Matcher Flow', () => {
    it('should complete full flow: API call → display routes → store state → transition', async () => {
      /**
       * BEHAVIOR: End-to-end integration test
       * Currently: Uses hardcoded mock data
       * Expected: Real API call with complete workflow
       */
      process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.railway.internal:3001';

      const mockApiRoutes = {
        routes: [
          {
            legs: [
              { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
              { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '11:45', arrival: '12:15' },
            ],
            totalDuration: '2h 15m',
          },
        ],
      };

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: mockApiRoutes,
      });

      const result = await routingSuggestionHandler(mockContext);

      // ASSERT: API called with query params and correlation ID
      expect(axios.get).toHaveBeenCalledWith(
        'http://journey-matcher.railway.internal:3001/routes?from=PAD&to=CDF&date=2025-01-24&time=10:00',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'test-corr-id-12345',
          }),
        })
      );

      // ASSERT: Response contains API data
      expect(result.response).toContain('PAD');
      expect(result.response).toContain('BRI');
      expect(result.response).toContain('CDF');
      expect(result.response).toContain('10:00');
      expect(result.response).toContain('11:30');

      // ASSERT: State updated
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
      expect(result.stateData?.suggestedRoute).toBeDefined();
      expect(result.stateData?.suggestedRoute?.totalDuration).toBe('2h 15m');

      // Cleanup
      delete process.env.JOURNEY_MATCHER_URL;
    });
  });
});
