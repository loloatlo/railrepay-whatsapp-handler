/**
 * Journey Confirm Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.8 Journey Confirm Handler
 * Per ADR-014: These tests define the behavior
 *
 * SIMPLIFIED: API call moved to journey-time.handler. This handler now only
 * handles YES/NO confirmation responses. Users have already seen the matched
 * route from journey-time.handler before reaching this state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// Use vi.hoisted() to ensure the mock logger is available before mock hoisting
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

    // BL-158: allRoutes must contain >= 2 routes so the NO path reaches
    // AWAITING_ROUTING_ALTERNATIVE rather than the single-route fallback.
    // matchedRoute is routes[0]; the alternatives are routes[1..n].
    const sharedRoute0 = {
      legs: [
        { from: 'Abergavenny', to: 'Hereford', departure: '08:31', arrival: '09:00', operator: 'TfW' },
      ],
      totalDuration: '29m',
      isDirect: true,
    };
    const sharedRoute1 = {
      legs: [
        { from: 'Abergavenny', to: 'Hereford', departure: '09:05', arrival: '09:35', operator: 'TfW' },
      ],
      totalDuration: '30m',
      isDirect: true,
    };

    mockContext = {
      phoneNumber: '+447700900123',
      messageBody: 'YES',
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
        matchedRoute: sharedRoute0,
        allRoutes: [sharedRoute0, sharedRoute1],
        isDirect: true,
      },
    };

    vi.clearAllMocks();
  });

  describe('Confirmation accepted (YES)', () => {
    it('should accept "YES" and transition to ticket upload', async () => {
      mockContext.messageBody = 'YES';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('confirmed');
      expect(result.response).toContain('ticket');
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
    });

    it('should accept "yes" (lowercase)', async () => {
      mockContext.messageBody = 'yes';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
    });

    it('should store confirmedRoute in stateData', async () => {
      mockContext.messageBody = 'YES';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.confirmedRoute).toBeDefined();
      expect(result.stateData?.journeyConfirmed).toBe(true);
    });

    it('should preserve previous stateData fields', async () => {
      mockContext.messageBody = 'YES';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.journeyId).toBe('test-journey-123');
      expect(result.stateData?.origin).toBe('AGV');
    });

    it('should log journey confirmation', async () => {
      mockContext.messageBody = 'YES';
      await journeyConfirmHandler(mockContext);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Journey confirmed by user',
        expect.objectContaining({
          correlationId: 'test-corr-id',
          journeyId: 'test-journey-123',
        })
      );
    });
  });

  describe('Confirmation rejected (NO)', () => {
    it('should accept "NO" and transition to AWAITING_ROUTING_ALTERNATIVE (was: AWAITING_JOURNEY_TIME) - AC-2', async () => {
      /**
       * TD-WHATSAPP-054 AC-2: journey-confirm NO path should go to AWAITING_ROUTING_ALTERNATIVE
       * User has already seen a matched route; rejecting it means they want alternatives, not to re-enter time
       */
      mockContext.messageBody = 'NO';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('alternative');
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
    });

    it('should accept "no" (lowercase) and transition to AWAITING_ROUTING_ALTERNATIVE - AC-2', async () => {
      mockContext.messageBody = 'no';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
    });

    it('should preserve stateData and set needsAlternatives flag', async () => {
      mockContext.messageBody = 'NO';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.stateData?.needsAlternatives).toBe(true);
      expect(result.stateData?.origin).toBe('AGV'); // Preserved
    });
  });

  describe('Missing matchedRoute', () => {
    it('should return error when matchedRoute is missing', async () => {
      mockContext.messageBody = 'YES';
      mockContext.stateData = {
        travelDate: '2026-01-24',
        journeyId: 'test-journey-123',
        // matchedRoute is missing
      };

      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('went wrong');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });
  });

  describe('Invalid input', () => {
    it('should reject other input and stay in same state', async () => {
      mockContext.messageBody = 'MAYBE';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.response).toContain('YES');
      expect(result.response).toContain('NO');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should handle empty input', async () => {
      mockContext.messageBody = '';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should handle whitespace-only input', async () => {
      mockContext.messageBody = '   ';
      const result = await journeyConfirmHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });
  });
});

/**
 * TD-WHATSAPP-063: OCR flow must publish journey event to trigger downstream pipeline
 *
 * TD CONTEXT: When a user confirms a journey via the OCR-skip path (stateData.scan_id
 * present), the handler transitions to AUTHENTICATED but does NOT include publishEvents
 * in the HandlerResult. The downstream pipeline (delay-tracker → eligibility-engine →
 * evaluation-coordinator → notification) never starts because no outbox event is written.
 *
 * REQUIRED FIX: When hasTicketFromOcr is true and user replies YES, the handler MUST
 * include a publishEvents array in its HandlerResult containing a 'journey.confirmed'
 * OutboxEvent with a payload satisfying JourneyConfirmedPayload from delay-tracker.
 */
describe('TD-WHATSAPP-063: OCR flow publishEvents', () => {
  let mockUser: User;
  let ocrContext: HandlerContext;

  // Shared OCR state data for historic journey (travelDate < 2026-04-05 = today)
  const ocrStateDataHistoric = {
    scan_id: 'test-scan-historic-001',
    image_gcs_path: 'gs://railrepay-tickets-prod/user-1/test-scan-historic-001.jpg',
    ocr_confidence: 0.98,
    journeyId: 'journey-ocr-historic-001',
    origin: 'CDF',
    destination: 'MAN',
    originName: 'Cardiff Central',
    destinationName: 'Manchester Stations',
    travelDate: '2026-03-11', // historic: before today 2026-04-05
    departureTime: '13:53',
    ticketType: 'off-peak',
    ticketClass: 'standard',
    farePence: 11440,
    matchedRoute: {
      legs: [
        {
          from: 'Cardiff Central',
          to: 'Manchester Piccadilly',
          departure: '13:53',
          arrival: '17:13',
          operator: '1:AW',
          tripId: '1:202603117664795',
        },
      ],
      totalDuration: '3h 20m',
      isDirect: true,
    },
    allRoutes: [
      {
        legs: [
          {
            from: 'Cardiff Central',
            to: 'Manchester Piccadilly',
            departure: '13:53',
            arrival: '17:13',
            operator: '1:AW',
            tripId: '1:202603117664795',
          },
        ],
        totalDuration: '3h 20m',
        isDirect: true,
      },
    ],
    isDirect: true,
  };

  // Separate state data for future journey (travelDate >= 2026-04-05)
  const ocrStateDataFuture = {
    scan_id: 'test-scan-future-002',
    image_gcs_path: 'gs://railrepay-tickets-prod/user-2/test-scan-future-002.jpg',
    ocr_confidence: 0.95,
    journeyId: 'journey-ocr-future-002',
    origin: 'EUS',
    destination: 'MAN',
    originName: 'London Euston',
    destinationName: 'Manchester Piccadilly',
    travelDate: '2027-01-15', // future: after today 2026-04-05
    departureTime: '09:03',
    ticketType: 'advance',
    ticketClass: 'standard',
    farePence: 5600,
    matchedRoute: {
      legs: [
        {
          from: 'London Euston',
          to: 'Manchester Piccadilly',
          departure: '09:03',
          arrival: '11:27',
          operator: '1:VT',
          tripId: '1:20270115-vt-0903',
        },
      ],
      totalDuration: '2h 24m',
      isDirect: true,
    },
    allRoutes: [
      {
        legs: [
          {
            from: 'London Euston',
            to: 'Manchester Piccadilly',
            departure: '09:03',
            arrival: '11:27',
            operator: '1:VT',
            tripId: '1:20270115-vt-0903',
          },
        ],
        totalDuration: '2h 24m',
        isDirect: true,
      },
    ],
    isDirect: true,
  };

  beforeEach(() => {
    mockUser = {
      id: 'user-ocr-456',
      phone_number: '+447700900456',
      verified_at: new Date('2025-01-15T10:00:00Z'),
      created_at: new Date('2025-01-15T10:00:00Z'),
      updated_at: new Date('2025-01-15T10:00:00Z'),
    };

    ocrContext = {
      phoneNumber: '+447700900456',
      messageBody: 'YES',
      messageSid: 'SM-ocr-test-001',
      user: mockUser,
      currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
      correlationId: 'corr-ocr-td063-001',
      stateData: { ...ocrStateDataHistoric },
    };

    vi.clearAllMocks();
  });

  // AC-1: publishEvents contains exactly one journey.confirmed event with required CRS/datetime/toc/segments fields
  describe('AC-1: publishEvents contains journey.confirmed event with required payload fields', () => {
    it('should include publishEvents with exactly one event when OCR scan_id is present', async () => {
      // AC-1: HandlerResult.publishEvents must contain exactly one event
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents).toBeDefined();
      expect(Array.isArray(result.publishEvents)).toBe(true);
      expect(result.publishEvents!.length).toBe(1);
    });

    it('should publish event with event_type journey.confirmed', async () => {
      // AC-1: event_type must be 'journey.confirmed'
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].event_type).toBe('journey.confirmed');
    });

    it('should include origin_crs in the published event payload', async () => {
      // AC-1: payload must include origin_crs
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.origin_crs).toBe('CDF');
    });

    it('should include destination_crs in the published event payload', async () => {
      // AC-1: payload must include destination_crs
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.destination_crs).toBe('MAN');
    });

    it('should include departure_datetime in the published event payload', async () => {
      // AC-1: payload must include departure_datetime combining travelDate and leg departure time
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.departure_datetime).toBeDefined();
      expect(typeof result.publishEvents![0].payload.departure_datetime).toBe('string');
      expect(result.publishEvents![0].payload.departure_datetime).toContain('2026-03-11');
      expect(result.publishEvents![0].payload.departure_datetime).toContain('13:53');
    });

    it('should include arrival_datetime in the published event payload', async () => {
      // AC-1: payload must include arrival_datetime combining travelDate and last leg arrival time
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.arrival_datetime).toBeDefined();
      expect(typeof result.publishEvents![0].payload.arrival_datetime).toBe('string');
      expect(result.publishEvents![0].payload.arrival_datetime).toContain('2026-03-11');
      expect(result.publishEvents![0].payload.arrival_datetime).toContain('17:13');
    });

    it('should include toc_code in the published event payload', async () => {
      // AC-1: payload must include toc_code (derived from leg operator field)
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.toc_code).toBeDefined();
      expect(typeof result.publishEvents![0].payload.toc_code).toBe('string');
    });

    it('should include segments array with at least one segment in the published event payload', async () => {
      // AC-1: payload must include segments/legs array
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      const payload = result.publishEvents![0].payload;
      // segments is the field delay-tracker expects (from JourneyConfirmedPayload)
      expect(payload.segments).toBeDefined();
      expect(Array.isArray(payload.segments)).toBe(true);
      expect(payload.segments.length).toBeGreaterThanOrEqual(1);
    });
  });

  // AC-2: Payload satisfies JourneyConfirmedPayload schema for delay-tracker
  describe('AC-2: Payload satisfies delay-tracker JourneyConfirmedPayload schema', () => {
    it('should include journey_id in the published event payload', async () => {
      // AC-2: journey_id required by JourneyConfirmedPayload
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.journey_id).toBeDefined();
      expect(typeof result.publishEvents![0].payload.journey_id).toBe('string');
      expect(result.publishEvents![0].payload.journey_id.length).toBeGreaterThan(0);
    });

    it('should include user_id in the published event payload', async () => {
      // AC-2: user_id required by JourneyConfirmedPayload
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.user_id).toBe('user-ocr-456');
    });

    it('should include journey_type in the published event payload', async () => {
      // AC-2: journey_type required by JourneyConfirmedPayload
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.journey_type).toBeDefined();
      expect(typeof result.publishEvents![0].payload.journey_type).toBe('string');
    });

    it('should include correlation_id in the published event payload', async () => {
      // AC-2: correlation_id required by JourneyConfirmedPayload
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.correlation_id).toBe('corr-ocr-td063-001');
    });

    it('should include aggregate_type journey on the OutboxEvent', async () => {
      // AC-2: OutboxEvent aggregate_type must be 'journey'
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].aggregate_type).toBe('journey');
    });

    it('should include a non-empty aggregate_id on the OutboxEvent', async () => {
      // AC-2: OutboxEvent aggregate_id must identify the journey
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].aggregate_id).toBeDefined();
      expect(typeof result.publishEvents![0].aggregate_id).toBe('string');
      expect(result.publishEvents![0].aggregate_id.length).toBeGreaterThan(0);
    });

    it('should set published_at to null on the OutboxEvent (unpublished)', async () => {
      // AC-2: OutboxEvent published_at must be null (outbox pattern — not yet dispatched)
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].published_at).toBeNull();
    });

    it('should include all six required JourneyConfirmedPayload fields simultaneously', async () => {
      // AC-2: Composite check — all required fields present in one payload
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      const payload = result.publishEvents![0].payload;
      expect(payload.journey_id).toBeDefined();
      expect(payload.user_id).toBeDefined();
      expect(payload.origin_crs).toBeDefined();
      expect(payload.destination_crs).toBeDefined();
      expect(payload.departure_datetime).toBeDefined();
      expect(payload.arrival_datetime).toBeDefined();
      expect(payload.journey_type).toBeDefined();
      expect(payload.toc_code).toBeDefined();
      expect(payload.segments).toBeDefined();
      expect(payload.correlation_id).toBeDefined();
    });
  });

  // AC-3: Historic travelDate still triggers event publication
  describe('AC-3: Historic travelDate still publishes the event', () => {
    it('should publish journey.confirmed event when travelDate is in the past', async () => {
      // AC-3: Past travelDate (2026-03-11 < 2026-04-05 today) must not suppress event
      ocrContext.stateData = { ...ocrStateDataHistoric }; // travelDate: '2026-03-11'
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents!.length).toBe(1);
      expect(result.publishEvents![0].event_type).toBe('journey.confirmed');
    });

    it('should transition to AUTHENTICATED for historic OCR journey', async () => {
      // AC-3: Handler must still reach AUTHENTICATED after publishing event
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should respond with historic-specific confirmation message for past journey', async () => {
      // AC-3: Historic path response should mention delay checking
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.response).toContain('confirmed');
    });
  });

  // AC-4: Future travelDate still triggers event publication
  describe('AC-4: Future travelDate still publishes the event', () => {
    it('should publish journey.confirmed event when travelDate is in the future', async () => {
      // AC-4: Future travelDate (2027-01-15 > 2026-04-05 today) must also publish event
      ocrContext.stateData = { ...ocrStateDataFuture }; // travelDate: '2027-01-15'
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents!.length).toBe(1);
      expect(result.publishEvents![0].event_type).toBe('journey.confirmed');
    });

    it('should transition to AUTHENTICATED for future OCR journey', async () => {
      // AC-4: Future journey also goes to AUTHENTICATED after event published
      ocrContext.stateData = { ...ocrStateDataFuture };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should include correct future departure_datetime for future journey', async () => {
      // AC-4: departure_datetime must reflect future travelDate
      ocrContext.stateData = { ...ocrStateDataFuture };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.departure_datetime).toContain('2027-01-15');
    });

    it('should differentiate future journey payload from historic journey payload', async () => {
      // AC-4: Future and historic journeys produce distinct payloads
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const historicResult = await journeyConfirmHandler(ocrContext);

      ocrContext.stateData = { ...ocrStateDataFuture };
      const futureResult = await journeyConfirmHandler(ocrContext);

      expect(historicResult.publishEvents![0].payload.departure_datetime).not.toBe(
        futureResult.publishEvents![0].payload.departure_datetime
      );
      expect(historicResult.publishEvents![0].payload.origin_crs).not.toBe(
        futureResult.publishEvents![0].payload.origin_crs
      );
    });
  });

  // AC-5: Payload includes OCR metadata (scan_id, image_gcs_path)
  describe('AC-5: Payload includes OCR metadata fields', () => {
    it('should include scan_id in the published event payload', async () => {
      // AC-5: scan_id must be present in payload so downstream knows this came from OCR
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.scan_id).toBe('test-scan-historic-001');
    });

    it('should include image_gcs_path in the published event payload', async () => {
      // AC-5: image_gcs_path must be present so downstream can reference the ticket image
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.image_gcs_path).toBe(
        'gs://railrepay-tickets-prod/user-1/test-scan-historic-001.jpg'
      );
    });

    it('should include distinct scan_id for future OCR journey', async () => {
      // AC-5: Each OCR journey has its own unique scan_id in payload
      ocrContext.stateData = { ...ocrStateDataFuture };
      const result = await journeyConfirmHandler(ocrContext);

      expect(result.publishEvents![0].payload.scan_id).toBe('test-scan-future-002');
    });

    it('should include both scan_id and image_gcs_path together in one event', async () => {
      // AC-5: Both OCR metadata fields must appear in the same payload simultaneously
      ocrContext.stateData = { ...ocrStateDataHistoric };
      const result = await journeyConfirmHandler(ocrContext);

      const payload = result.publishEvents![0].payload;
      expect(payload.scan_id).toBeDefined();
      expect(payload.image_gcs_path).toBeDefined();
    });
  });

  // AC-6: Manual flow (no scan_id) does NOT take OCR-skip path
  describe('AC-6: Manual flow without scan_id does not publish journey.confirmed', () => {
    it('should NOT include publishEvents when scan_id is absent', async () => {
      // AC-6: Without scan_id the OCR path is not taken — no publishEvents emitted
      ocrContext.stateData = {
        journeyId: 'journey-manual-no-scan-003',
        origin: 'AGV',
        destination: 'HFD',
        originName: 'Abergavenny',
        destinationName: 'Hereford',
        travelDate: '2026-03-20',
        departureTime: '08:30',
        matchedRoute: {
          legs: [
            {
              from: 'Abergavenny',
              to: 'Hereford',
              departure: '08:31',
              arrival: '09:00',
              operator: '1:AW',
            },
          ],
          totalDuration: '29m',
          isDirect: true,
        },
        allRoutes: [
          {
            legs: [
              {
                from: 'Abergavenny',
                to: 'Hereford',
                departure: '08:31',
                arrival: '09:00',
                operator: '1:AW',
              },
            ],
            totalDuration: '29m',
            isDirect: true,
          },
        ],
        isDirect: true,
        // scan_id is intentionally absent
      };

      const result = await journeyConfirmHandler(ocrContext);

      // Manual flow should go to AWAITING_TICKET_UPLOAD, not AUTHENTICATED
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      // Manual flow must not include publishEvents (event published later by ticket-upload handler)
      expect(result.publishEvents).toBeUndefined();
    });

    it('should transition to AWAITING_TICKET_UPLOAD not AUTHENTICATED when scan_id is absent', async () => {
      // AC-6: Manual flow delegates ticket collection to ticket-upload handler
      ocrContext.stateData = {
        journeyId: 'journey-manual-no-scan-004',
        origin: 'BHM',
        destination: 'LDS',
        originName: 'Birmingham New Street',
        destinationName: 'Leeds',
        travelDate: '2026-04-10',
        departureTime: '11:15',
        matchedRoute: {
          legs: [
            {
              from: 'Birmingham New Street',
              to: 'Leeds',
              departure: '11:15',
              arrival: '13:22',
              operator: '1:XC',
            },
          ],
          totalDuration: '2h 7m',
          isDirect: true,
        },
        allRoutes: [
          {
            legs: [
              {
                from: 'Birmingham New Street',
                to: 'Leeds',
                departure: '11:15',
                arrival: '13:22',
                operator: '1:XC',
              },
            ],
            totalDuration: '2h 7m',
            isDirect: true,
          },
        ],
        isDirect: true,
        // scan_id deliberately omitted
      };

      const result = await journeyConfirmHandler(ocrContext);

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
    });

    it('should produce different nextState for OCR flow vs manual flow', async () => {
      // AC-6: OCR and manual flows diverge at this handler — AUTHENTICATED vs AWAITING_TICKET_UPLOAD
      const manualStateData = {
        journeyId: 'journey-manual-diverge-005',
        origin: 'NRW',
        destination: 'LST',
        travelDate: '2026-03-25',
        departureTime: '14:00',
        matchedRoute: {
          legs: [
            {
              from: 'Norwich',
              to: 'London Liverpool Street',
              departure: '14:00',
              arrival: '15:56',
              operator: '1:LE',
            },
          ],
          totalDuration: '1h 56m',
          isDirect: true,
        },
        allRoutes: [],
        isDirect: true,
        // scan_id absent
      };

      ocrContext.stateData = { ...ocrStateDataHistoric };
      const ocrResult = await journeyConfirmHandler(ocrContext);

      ocrContext.stateData = manualStateData;
      const manualResult = await journeyConfirmHandler(ocrContext);

      expect(ocrResult.nextState).toBe(FSMState.AUTHENTICATED);
      expect(manualResult.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      expect(ocrResult.nextState).not.toBe(manualResult.nextState);
    });
  });
});
