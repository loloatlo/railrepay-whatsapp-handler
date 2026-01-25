/**
 * Journey Confirm Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.8 Journey Confirm Handler
 * Per ADR-014: These tests define the behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { journeyConfirmHandler } from '../../../src/handlers/journey-confirm.handler';
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

// Mock axios for HTTP client testing (TD-WHATSAPP-040)
vi.mock('axios');
import axios from 'axios';

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

  describe('TD-WHATSAPP-040: Inline Routing Check (Option C)', () => {
    /**
     * TD CONTEXT: State machine gap - journey-confirm.handler transitions to AWAITING_ROUTING_CONFIRM
     * but routing-suggestion.handler expects to be called from AWAITING_JOURNEY_TIME to fetch routes.
     * This creates a "dead end" where routes are never fetched before asking for confirmation.
     *
     * APPROVED SOLUTION (Option C): journey-confirm.handler calls journey-matcher API directly
     * - If direct route (no interchange): Skip routing confirmation, go to AWAITING_TICKET_UPLOAD
     * - If interchange route: Present route details, go to AWAITING_ROUTING_CONFIRM
     * - If API error: User-friendly error, stay in AWAITING_JOURNEY_CONFIRM
     *
     * DEPENDENCIES: TD-WHATSAPP-038 (stateData), TD-WHATSAPP-039 (timeout)
     */

    beforeEach(() => {
      // Environment variable required for journey-matcher API (per Section 6.2.1)
      process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.test:3001';
    });

    afterEach(() => {
      delete process.env.JOURNEY_MATCHER_URL;
      vi.clearAllMocks();
    });

    describe('Direct route (no interchange)', () => {
      it('should call journey-matcher API when user confirms journey (was: no API call made)', async () => {
        // Arrange: Mock journey-matcher API to return direct route
        // Verified: journey-matcher/src/api/routes.ts exposes GET /routes
        vi.mocked(axios.get).mockResolvedValue({
          status: 200,
          data: {
            routes: [{
              isDirect: true,
              legs: [{
                from: 'PAD',
                to: 'BRI',
                operator: 'GWR',
                departure: '10:00',
                arrival: '11:30',
              }],
              totalDuration: '1h 30m',
            }],
          },
        });

        mockContext.messageBody = 'YES';
        mockContext.stateData = {
          journeyId: 'journey-direct-123',
          origin: 'PAD',
          destination: 'BRI',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        };

        // Act
        await journeyConfirmHandler(mockContext);

        // Assert: Verify API was called with journey parameters
        expect(axios.get).toHaveBeenCalledWith(
          expect.stringContaining('/routes'),
          expect.objectContaining({
            params: expect.objectContaining({
              from: 'PAD',
              to: 'BRI',
              date: '2024-12-20',
              time: '10:00',
            }),
            timeout: 15000, // TD-WHATSAPP-039: Must include timeout
            headers: expect.objectContaining({
              'X-Correlation-ID': 'test-corr-id',
            }),
          })
        );
      });

      it('should skip routing confirmation and go directly to ticket upload for direct routes (was: always went to AWAITING_ROUTING_CONFIRM)', async () => {
        // Arrange: Direct route (no interchange)
        vi.mocked(axios.get).mockResolvedValue({
          status: 200,
          data: {
            routes: [{
              isDirect: true, // KEY: Direct route flag
              legs: [{
                from: 'PAD',
                to: 'BRI',
                operator: 'GWR',
                departure: '10:00',
                arrival: '11:30',
              }],
              totalDuration: '1h 30m',
            }],
          },
        });

        mockContext.messageBody = 'YES';
        mockContext.stateData = {
          journeyId: 'journey-direct-123',
          origin: 'PAD',
          destination: 'BRI',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        };

        // Act
        const result = await journeyConfirmHandler(mockContext);

        // Assert: Skips routing confirmation, goes straight to ticket upload
        expect(result.response).toContain('direct');
        expect(result.response).toContain('ticket');
        expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
        expect(result.nextState).not.toBe(FSMState.AWAITING_ROUTING_CONFIRM); // NOT routing confirmation
      });

      it('should store route data in stateData for ticket upload handler', async () => {
        // Arrange
        vi.mocked(axios.get).mockResolvedValue({
          status: 200,
          data: {
            routes: [{
              isDirect: true,
              legs: [{
                from: 'PAD',
                to: 'BRI',
                operator: 'GWR',
                departure: '10:00',
                arrival: '11:30',
              }],
              totalDuration: '1h 30m',
            }],
          },
        });

        mockContext.messageBody = 'YES';
        mockContext.stateData = {
          journeyId: 'journey-direct-123',
          origin: 'PAD',
          destination: 'BRI',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        };

        // Act
        const result = await journeyConfirmHandler(mockContext);

        // Assert: Route data stored in state
        expect(result.stateData).toBeDefined();
        expect(result.stateData?.confirmedRoute).toBeDefined();
        expect(result.stateData?.confirmedRoute.isDirect).toBe(true);
      });
    });

    describe('Interchange route', () => {
      it('should present routing details when journey requires interchange (was: no routing details shown)', async () => {
        // Arrange: Route with interchange at Bristol
        vi.mocked(axios.get).mockResolvedValue({
          status: 200,
          data: {
            routes: [{
              isDirect: false,
              interchangeStation: 'BRI',
              legs: [
                { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
                { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '11:45', arrival: '12:15' },
              ],
              totalDuration: '2h 15m',
            }],
          },
        });

        mockContext.messageBody = 'YES';
        mockContext.stateData = {
          journeyId: 'journey-interchange-456',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        };

        // Act
        const result = await journeyConfirmHandler(mockContext);

        // Assert: Response mentions interchange station
        expect(result.response).toContain('interchange');
        expect(result.response).toContain('BRI'); // Interchange station name
        expect(result.response).toContain('change'); // Indicates change required
      });

      it('should transition to AWAITING_ROUTING_CONFIRM for interchange routes (was: always transitioned regardless of route type)', async () => {
        // Arrange
        vi.mocked(axios.get).mockResolvedValue({
          status: 200,
          data: {
            routes: [{
              isDirect: false,
              interchangeStation: 'BRI',
              legs: [
                { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
                { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '11:45', arrival: '12:15' },
              ],
              totalDuration: '2h 15m',
            }],
          },
        });

        mockContext.messageBody = 'YES';
        mockContext.stateData = {
          journeyId: 'journey-interchange-456',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        };

        // Act
        const result = await journeyConfirmHandler(mockContext);

        // Assert: Transitions to routing confirmation state
        expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
      });

      it('should store route data in stateData for routing-suggestion.handler', async () => {
        // Arrange
        vi.mocked(axios.get).mockResolvedValue({
          status: 200,
          data: {
            routes: [{
              isDirect: false,
              interchangeStation: 'BRI',
              legs: [
                { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
                { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '11:45', arrival: '12:15' },
              ],
              totalDuration: '2h 15m',
            }],
          },
        });

        mockContext.messageBody = 'YES';
        mockContext.stateData = {
          journeyId: 'journey-interchange-456',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        };

        // Act
        const result = await journeyConfirmHandler(mockContext);

        // Assert: Route data passed to next handler
        expect(result.stateData).toBeDefined();
        expect(result.stateData?.suggestedRoute).toBeDefined();
        expect(result.stateData?.suggestedRoute.isDirect).toBe(false);
        expect(result.stateData?.suggestedRoute.interchangeStation).toBe('BRI');
      });
    });

    describe('API error handling', () => {
      it('should return user-friendly error message when journey-matcher API fails (was: unhandled API error)', async () => {
        // Arrange: API returns error
        vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

        mockContext.messageBody = 'YES';
        mockContext.stateData = {
          journeyId: 'journey-error-789',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        };

        // Act
        const result = await journeyConfirmHandler(mockContext);

        // Assert: User-friendly error, no technical details
        expect(result.response).toContain('unable');
        expect(result.response).toContain('try again');
        expect(result.response).not.toContain('Network error'); // No technical error
      });

      it('should stay in AWAITING_JOURNEY_CONFIRM when API fails (allows retry)', async () => {
        // Arrange
        vi.mocked(axios.get).mockRejectedValue(new Error('Timeout'));

        mockContext.messageBody = 'YES';
        mockContext.stateData = {
          journeyId: 'journey-error-789',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        };

        // Act
        const result = await journeyConfirmHandler(mockContext);

        // Assert: Stays in same state (user can retry YES)
        expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
      });

      it('should log API error with correlation ID for observability', async () => {
        // Arrange
        const apiError = new Error('journey-matcher unavailable');
        vi.mocked(axios.get).mockRejectedValue(apiError);

        mockContext.messageBody = 'YES';
        mockContext.correlationId = 'test-api-error-corr';
        mockContext.stateData = {
          journeyId: 'journey-error-789',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-20',
          departureTime: '10:00',
        };

        // Act
        await journeyConfirmHandler(mockContext);

        // Assert: Winston logger called with error and correlation ID
        expect(sharedLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('journey-matcher'),
          expect.objectContaining({
            correlationId: 'test-api-error-corr',
            error: expect.stringContaining('unavailable'),
          })
        );
      });
    });
  });
});
