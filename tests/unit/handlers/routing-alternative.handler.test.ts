/**
 * TD-WHATSAPP-054: Routing Alternative Handler Tests - Remove Hardcoded Mocks
 *
 * TECHNICAL DEBT CONTEXT:
 * Current implementation uses hardcoded PAD-RDG-CDF routes instead of:
 * - Set 1: Using stateData.allRoutes (from journey-time.handler)
 * - Set 2+: Calling journey-matcher API with offset parameter
 *
 * REQUIRED FIX:
 * - AC-1: Use real data from stateData/API instead of hardcoded mocks
 * - AC-3: AWAITING_ROUTING_ALTERNATIVE reachable from AWAITING_ROUTING_CONFIRM
 * - AC-4: Store full route object, not just index number
 * - AC-5: After 3 sets, transition to ERROR with escalation event
 *
 * Per ADR-014: Tests written FIRST, implementation follows
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';
import axios from 'axios';

// Mock winston logger (shared instance per Section 6.1.11)
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// Mock axios for journey-matcher API calls
vi.mock('axios');

// Import handler after mocks
import { routingAlternativeHandler } from '../../../src/handlers/routing-alternative.handler';

describe('TD-WHATSAPP-054: Routing Alternative Handler (Remove Hardcoded Mocks)', () => {
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

  describe('AC-1: Use stateData routes (Set 1) instead of hardcoded mocks', () => {
    it('should display routes from stateData.allRoutes when entering from AWAITING_ROUTING_CONFIRM (was: hardcoded PAD-RDG-CDF)', async () => {
      // AC-1: routing-alternative.handler uses stateData routes for Set 1
      // BEHAVIOR: When user rejects suggested route, display allRoutes[1], [2], [3] (skip [0] which was suggested)

      const allRoutes = [
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
      ];

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_CONFIRM,
        messageBody: 'NO',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          allRoutes, // Populated by journey-time.handler
        },
      });

      // Assert: Response contains routes from stateData, NOT hardcoded PAD-RDG-CDF
      expect(result.response).toContain('AGV');
      expect(result.response).toContain('HFD');
      expect(result.response).toContain('09:31'); // Second route (index 1)
      expect(result.response).toContain('10:31'); // Third route (index 2)
      expect(result.response).toContain('11:31'); // Fourth route (index 3)

      // Assert: Should NOT contain hardcoded stations
      expect(result.response).not.toContain('PAD');
      expect(result.response).not.toContain('RDG');
      expect(result.response).not.toContain('CDF');
      expect(result.response).not.toContain('BHM');
      expect(result.response).not.toContain('SWA');

      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
      expect(result.stateData?.alternativeCount).toBe(1);
    });

    it('should display only available routes when allRoutes has fewer than 4 routes', async () => {
      // BEHAVIOR: If journey-matcher only returned 2 routes total, only show allRoutes[1] (the one remaining alternative)

      const allRoutes = [
        {
          legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
          totalDuration: '29m',
        },
        {
          legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }],
          totalDuration: '29m',
        },
      ];

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_CONFIRM,
        messageBody: 'NO',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          allRoutes,
        },
      });

      // Assert: Only one alternative shown (allRoutes[1])
      expect(result.response).toContain('09:31');
      expect(result.response).toContain('1.'); // First option
      expect(result.response).not.toContain('2.'); // No second option
    });

    it('should fall back to journey-matcher API when stateData.allRoutes is empty', async () => {
      // BEHAVIOR: If no additional routes in stateData, immediately call journey-matcher API
      // Verified: journey-matcher service exposes GET /routes endpoint (src/api/routes.ts)

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: {
          routes: [
            {
              legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '12:31', arrival: '13:00' }],
              totalDuration: '29m',
            },
          ],
        },
      });

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_CONFIRM,
        messageBody: 'NO',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          allRoutes: [
            {
              legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
              totalDuration: '29m',
            },
          ], // Only 1 route (the suggested one), no alternatives
        },
      });

      // Assert: axios.get was called with offset parameter
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/routes'),
        expect.objectContaining({
          params: expect.objectContaining({
            from: 'AGV',
            to: 'HFD',
            date: '2026-01-24',
            time: '08:30',
            offset: 3, // Set 1 offset (skip first 3 routes)
          }),
        })
      );
    });
  });

  describe('AC-1: Use journey-matcher API for Set 2+ instead of hardcoded mocks', () => {
    it('should call journey-matcher API with offset when user says NONE (was: showing same hardcoded routes)', async () => {
      // AC-1: Set 2+ alternatives use journey-matcher API with offset parameter
      // Verified: journey-matcher service exposes GET /routes endpoint (src/api/routes.ts)

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
            {
              legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '16:31', arrival: '17:00' }],
              totalDuration: '29m',
            },
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
          alternativeCount: 1, // First rejection
        },
      });

      // Assert: API called with offset=3 (Set 2: skip first 3 routes)
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/routes'),
        expect.objectContaining({
          params: expect.objectContaining({
            from: 'AGV',
            to: 'HFD',
            date: '2026-01-24',
            time: '08:30',
            offset: 3, // alternativeCount * 3 = 1 * 3 = 3
          }),
        })
      );

      // Assert: Response contains new routes from API, NOT hardcoded
      expect(result.response).toContain('14:31');
      expect(result.response).toContain('15:31');
      expect(result.response).toContain('16:31');
      expect(result.response).not.toContain('PAD');
      expect(result.response).not.toContain('RDG');

      expect(result.stateData?.alternativeCount).toBe(2);
    });

    it('should propagate correlation ID in API call header (was: no correlation ID propagation)', async () => {
      // AC-1: Correlation IDs must be propagated for distributed tracing

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: {
          routes: [
            { legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '14:31', arrival: '15:00' }], totalDuration: '29m' },
          ],
        },
      });

      await routingAlternativeHandler({
        ...mockContext,
        correlationId: 'test-correlation-id-123',
        messageBody: 'NONE',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          alternativeCount: 1,
        },
      });

      // Assert: Correlation ID included in headers
      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'test-correlation-id-123',
          }),
        })
      );
    });

    it('should include timeout option in axios call (per TD-WHATSAPP-039)', async () => {
      // REQUIREMENT: All axios calls must include timeout: 15000

      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: { routes: [{ legs: [], totalDuration: '0m' }] },
      });

      await routingAlternativeHandler({
        ...mockContext,
        messageBody: 'NONE',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          alternativeCount: 1,
        },
      });

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timeout: 15000,
        })
      );
    });
  });

  describe('AC-3: AWAITING_ROUTING_ALTERNATIVE reachable from AWAITING_ROUTING_CONFIRM', () => {
    it('should transition to AWAITING_ROUTING_ALTERNATIVE when user says NO in AWAITING_ROUTING_CONFIRM state', async () => {
      // AC-3: User can reach AWAITING_ROUTING_ALTERNATIVE by rejecting routing suggestion

      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_CONFIRM,
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

      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
      expect(result.response).toContain('alternative');
    });
  });

  describe('AC-4: Store full route object instead of index number', () => {
    it('should store full route object in stateData.confirmedRoute when user selects option (was: storing only index number)', async () => {
      // AC-4: Route selection stores full route object, not just selectedAlternative: 2

      const displayedRoutes = [
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
      ];

      const result = await routingAlternativeHandler({
        ...mockContext,
        messageBody: '2', // User selects second option
        stateData: {
          journeyId: 'journey-789',
          currentAlternatives: displayedRoutes, // Currently displayed alternatives
        },
      });

      // Assert: stateData contains full route object
      expect(result.stateData?.confirmedRoute).toBeDefined();
      expect(result.stateData?.confirmedRoute).toEqual(displayedRoutes[1]); // Second option (index 1)
      expect(result.stateData?.confirmedRoute.legs).toBeDefined();
      expect(result.stateData?.confirmedRoute.totalDuration).toBe('29m');

      // Assert: stateData is NOT just a number
      expect(typeof result.stateData?.confirmedRoute).not.toBe('number');

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      expect(result.stateData?.routingConfirmed).toBe(true);
    });

    it('should preserve all journey context fields when storing confirmedRoute', async () => {
      // AC-4: Ensure stateData propagation works correctly

      const result = await routingAlternativeHandler({
        ...mockContext,
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

      // Assert: All previous stateData fields preserved
      expect(result.stateData?.journeyId).toBe('journey-789');
      expect(result.stateData?.origin).toBe('AGV');
      expect(result.stateData?.destination).toBe('HFD');
      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.departureTime).toBe('08:30');
    });
  });

  describe('AC-5: NONE after 3 sets transitions to ERROR with escalation event', () => {
    it('should transition to ERROR state when alternativeCount reaches 3 and user says NONE (was: continuing indefinitely)', async () => {
      // AC-5: After 3 sets of alternatives rejected, escalate to manual support

      const result = await routingAlternativeHandler({
        ...mockContext,
        messageBody: 'NONE',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          alternativeCount: 3, // Third rejection
        },
      });

      expect(result.nextState).toBe(FSMState.ERROR);
      expect(result.response).toContain('unable to find');
      expect(result.response).toContain('escalate');
      expect(result.response).toContain('24 hours');
    });

    it('should publish journey.routing_escalation event with real journeyId (was: hardcoded journey-456)', async () => {
      // AC-5: Escalation event must use real journeyId from stateData

      const result = await routingAlternativeHandler({
        ...mockContext,
        messageBody: 'NONE',
        stateData: {
          journeyId: 'journey-real-abc-123',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          alternativeCount: 3,
        },
      });

      // Assert: publishEvents contains escalation event
      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents?.length).toBeGreaterThan(0);

      const escalationEvent = result.publishEvents?.[0];
      expect(escalationEvent?.event_type).toBe('journey.routing_escalation');
      expect(escalationEvent?.aggregate_type).toBe('journey');
      expect(escalationEvent?.aggregate_id).toBe('journey-real-abc-123'); // Real journeyId, NOT 'journey-456'
      expect(escalationEvent?.payload.journeyId).toBe('journey-real-abc-123');
      expect(escalationEvent?.payload.userId).toBe('user-123');
      expect(escalationEvent?.payload.reason).toBe('max_alternatives_exceeded');
      expect(escalationEvent?.payload.alternativeCount).toBe(3);
    });
  });

  describe('stateData propagation across all paths', () => {
    it('should preserve all stateData fields when displaying alternatives (Set 1)', async () => {
      const result = await routingAlternativeHandler({
        ...mockContext,
        currentState: FSMState.AWAITING_ROUTING_CONFIRM,
        messageBody: 'NO',
        stateData: {
          journeyId: 'journey-789',
          origin: 'AGV',
          destination: 'HFD',
          travelDate: '2026-01-24',
          departureTime: '08:30',
          originName: 'Abergavenny',
          destinationName: 'Hereford',
          allRoutes: [
            { legs: [], totalDuration: '29m' },
            { legs: [], totalDuration: '30m' },
          ],
        },
      });

      expect(result.stateData?.journeyId).toBe('journey-789');
      expect(result.stateData?.origin).toBe('AGV');
      expect(result.stateData?.destination).toBe('HFD');
      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.departureTime).toBe('08:30');
      expect(result.stateData?.originName).toBe('Abergavenny');
      expect(result.stateData?.destinationName).toBe('Hereford');
    });

    it('should preserve all stateData fields when user says NONE (Set 2+)', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        data: { routes: [{ legs: [], totalDuration: '29m' }] },
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
          alternativeCount: 1,
        },
      });

      expect(result.stateData?.journeyId).toBe('journey-789');
      expect(result.stateData?.origin).toBe('AGV');
      expect(result.stateData?.destination).toBe('HFD');
    });
  });

  describe('Invalid input handling', () => {
    it('should reject input other than 1, 2, 3, or NONE', async () => {
      const result = await routingAlternativeHandler({
        ...mockContext,
        messageBody: 'INVALID',
      });

      expect(result.response).toContain('1, 2, or 3');
      expect(result.response).toContain('NONE');
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
    });
  });
});
