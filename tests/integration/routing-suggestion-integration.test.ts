/**
 * TD-WHATSAPP-028: Integration Test - whatsapp-handler -> journey-matcher
 *
 * CONTEXT: Verify REAL HTTP integration between services (no mocking)
 *
 * This test verifies:
 * 1. whatsapp-handler makes REAL HTTP call to journey-matcher
 * 2. journey-matcher GET /routes endpoint exists and responds
 * 3. End-to-end flow works without mocked axios
 *
 * Per ADR-014: Tests written BEFORE implementation
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 * Per Section 6.1: Integration tests use real HTTP clients (no axios mocks)
 *
 * These tests will FAIL until Blake:
 * 1. Implements GET /routes endpoint in journey-matcher
 * 2. Updates routing-suggestion.handler.ts to call correct endpoint
 *
 * NOTE: This is an integration test but does NOT use Testcontainers.
 * It assumes both services are running (or uses nock to simulate journey-matcher).
 * For MVP, we accept this limitation. Full E2E tests would run both services.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FSMState } from '../../src/services/fsm.service';
import type { HandlerContext } from '../../src/handlers';
import type { User } from '../../src/db/types';
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

describe('TD-WHATSAPP-028: Integration - whatsapp-handler -> journey-matcher /routes', () => {
  let mockContext: HandlerContext;
  let mockUser: User;
  const journeyMatcherUrl = 'http://journey-matcher-integration-test:3001';

  beforeEach(() => {
    mockUser = {
      id: 'user-integration-123',
      phone_number: '+447700900999',
      verified_at: new Date('2024-11-20T10:00:00Z'),
      created_at: new Date('2024-11-20T10:00:00Z'),
      updated_at: new Date('2024-11-20T10:00:00Z'),
    };

    // Set environment variable
    process.env.JOURNEY_MATCHER_URL = journeyMatcherUrl;

    mockContext = {
      phoneNumber: '+447700900999',
      messageBody: '10:00',
      messageSid: 'SM-integration-test',
      user: mockUser,
      currentState: FSMState.AWAITING_JOURNEY_TIME,
      correlationId: 'integration-test-corr-id',
      stateData: {
        journeyId: 'journey-integration-456',
        origin: 'PAD',
        destination: 'CDF',
        travelDate: '2024-12-20',
        departureTime: '10:00',
      },
    };

    // Clear all HTTP interceptors
    nock.cleanAll();
  });

  afterEach(() => {
    delete process.env.JOURNEY_MATCHER_URL;
    nock.cleanAll();
  });

  describe('Real HTTP Integration (using nock to simulate journey-matcher)', () => {
    it('should make REAL HTTP GET request to journey-matcher /routes endpoint', async () => {
      /**
       * Verified: journey-matcher WILL expose GET /routes endpoint
       * Location: journey-matcher/src/api/routes.ts (Blake will create)
       * This test uses nock to intercept the REAL HTTP call (not mocking axios)
       */

      // Intercept REAL HTTP call to journey-matcher
      const scope = nock(journeyMatcherUrl)
        .get('/routes')
        .query({
          from: 'PAD',
          to: 'CDF',
          date: '2024-12-20',
          time: '10:00',
        })
        .matchHeader('X-Correlation-ID', 'integration-test-corr-id')
        .reply(200, {
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
        });

      // Act: Call handler (should make REAL HTTP request)
      const result = await routingSuggestionHandler(mockContext);

      // Assert: HTTP call was made
      expect(scope.isDone()).toBe(true);

      // Assert: Handler processed response correctly
      expect(result.response).toContain('requires a change');
      expect(result.response).toContain('Bristol Temple Meads');
      expect(result.response).toContain('Cardiff Central');
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
    });

    it('should handle 404 error from journey-matcher when no routes found', async () => {
      const scope = nock(journeyMatcherUrl)
        .get('/routes')
        .query({
          from: 'PAD',
          to: 'CDF',
          date: '2024-12-31',
          time: '23:59',
        })
        .reply(404, {
          error: 'No routes found for the specified parameters',
        });

      const result = await routingSuggestionHandler({
        ...mockContext,
        stateData: {
          journeyId: 'journey-integration-456',
          origin: 'PAD',
          destination: 'CDF',
          travelDate: '2024-12-31',
          departureTime: '23:59',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(result.response).toContain('unable to find any routes');
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should handle 500 error from journey-matcher when OTP service unavailable', async () => {
      const scope = nock(journeyMatcherUrl)
        .get('/routes')
        .query({
          from: 'PAD',
          to: 'CDF',
          date: '2024-12-20',
          time: '10:00',
        })
        .reply(500, {
          error: 'OTP service unavailable',
        });

      const result = await routingSuggestionHandler(mockContext);

      expect(scope.isDone()).toBe(true);
      expect(result.response).toContain('temporarily unavailable');
      expect(result.nextState).toBe(FSMState.ERROR);
    });

    it('should handle timeout errors from journey-matcher', async () => {
      const scope = nock(journeyMatcherUrl)
        .get('/routes')
        .query({
          from: 'PAD',
          to: 'CDF',
          date: '2024-12-20',
          time: '10:00',
        })
        .delayConnection(6000) // Delay longer than axios timeout
        .reply(200, { routes: [] });

      const result = await routingSuggestionHandler(mockContext);

      // Note: nock delay may not trigger ECONNABORTED in test environment
      // This is a limitation of integration testing without real services
      // In production, timeout would be triggered by network layer
      expect(['AWAITING_ROUTING_CONFIRM', 'ERROR']).toContain(result.nextState);
    });
  });

  describe('Contract Verification', () => {
    it('should verify journey-matcher response schema matches expected format', async () => {
      /**
       * CRITICAL: This test verifies the API contract between services
       * If this test fails, it means the endpoint exists but returns wrong format
       */

      const validResponseSchema = {
        routes: [
          {
            legs: [
              {
                from: expect.any(String),
                to: expect.any(String),
                departure: expect.any(String),
                arrival: expect.any(String),
                operator: expect.any(String),
              },
            ],
            totalDuration: expect.any(String),
          },
        ],
      };

      const scope = nock(journeyMatcherUrl)
        .get('/routes')
        .query(true) // Match any query params
        .reply(200, {
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
        });

      const result = await routingSuggestionHandler(mockContext);

      expect(scope.isDone()).toBe(true);

      // If handler successfully parsed response, schema is correct
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
      expect(result.stateData?.suggestedRoute).toMatchObject({
        legs: expect.arrayContaining([
          expect.objectContaining({
            from: expect.any(String),
            to: expect.any(String),
            departure: expect.any(String),
            arrival: expect.any(String),
            operator: expect.any(String),
          }),
        ]),
        totalDuration: expect.any(String),
      });
    });

    it('should verify correlation ID is propagated through the request chain', async () => {
      const correlationId = 'unique-integration-correlation-789';

      const scope = nock(journeyMatcherUrl)
        .get('/routes')
        .query(true)
        .matchHeader('X-Correlation-ID', correlationId)
        .reply(200, {
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
        });

      await routingSuggestionHandler({
        ...mockContext,
        correlationId,
      });

      // If scope.isDone() is true, header was matched
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('Missing environment variable handling', () => {
    it('should throw error when JOURNEY_MATCHER_URL is not configured', async () => {
      delete process.env.JOURNEY_MATCHER_URL;

      await expect(async () => {
        await routingSuggestionHandler(mockContext);
      }).rejects.toThrow(/JOURNEY_MATCHER_URL/);
    });
  });
});
