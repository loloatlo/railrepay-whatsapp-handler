/**
 * BL-181 Sub-task 3: whatsapp-handler connection threshold changes
 * Phase TD-1 Test Specification — Written FIRST per ADR-014 (TDD)
 *
 * GOVERING ADR: ADR-021 (delay measurement methodology)
 * BACKLOG: BL-181 (TD-DELAY-CALC-001)
 *
 * CONTEXT:
 *   AC-6: The journey.confirmed Kafka event payload must include
 *         connectionThresholdMinutes for multi-leg journeys.
 *         Formula (from ADR-021):
 *           connectionThreshold = (nextLeg.scheduledDeparture - currentLeg.scheduledArrival)
 *                                 - PLATFORM_DISCOUNT
 *         For single-leg journeys the field must be null (no connection exists).
 *
 *   AC-7: PLATFORM_DISCOUNT is configurable via env var PLATFORM_DISCOUNT_MINUTES.
 *         Default value is 3 minutes when the env var is not set.
 *
 * THESE TESTS MUST FAIL (RED) before Blake's implementation.
 * Blake will add connectionThresholdMinutes computation to journey-confirm.handler.ts
 * and introduce the PLATFORM_DISCOUNT_MINUTES env var.
 *
 * Test Lock Rule: Blake MUST NOT modify these tests.
 * Per ADR-014 (TDD), per ADR-004 (Vitest).
 *
 * HOW connectionThresholdMinutes IS CALCULATED:
 *   Given legs with HH:MM departure/arrival strings and a shared travelDate:
 *     scheduledDepartureNextLeg = `${travelDate}T${nextLeg.departure}:00Z`
 *     scheduledArrivalCurrentLeg = `${travelDate}T${currentLeg.arrival}:00Z`
 *     layoverMinutes = (Date(scheduledDepartureNextLeg) - Date(scheduledArrivalCurrentLeg)) / 60000
 *     connectionThresholdMinutes = layoverMinutes - PLATFORM_DISCOUNT_MINUTES
 *   For journeys with more than one connection, connectionThresholdMinutes is the
 *   threshold for the FIRST connection (index 0 → index 1).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';
import { FSMState } from '../../../src/services/fsm.service';

// Shared mock logger instance — must be created via vi.hoisted() so it is available
// before Vitest hoists the vi.mock() factory. This ensures all tests assert against
// the same instance. (Per Jessie guideline 11: infrastructure package mocking.)
const sharedMockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedMockLogger),
}));

// Import handler AFTER mocks are hoisted
import { journeyConfirmHandler } from '../../../src/handlers/journey-confirm.handler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockUser: User = {
  id: 'user-bl181-001',
  phone_number: '+447700900771',
  verified_at: new Date('2025-06-01T09:00:00Z'),
  created_at: new Date('2025-06-01T09:00:00Z'),
  updated_at: new Date('2025-06-01T09:00:00Z'),
};

/**
 * Single-leg OCR journey: Cardiff Central → Manchester Piccadilly (direct, no connection)
 * travelDate: 2026-05-12 (historic relative to 2026-04-05 test date)
 */
const singleLegOcrStateData = {
  scan_id: 'scan-bl181-single-001',
  image_gcs_path: 'gs://railrepay-tickets-prod/user-bl181-001/scan-bl181-single-001.jpg',
  journeyId: 'journey-bl181-single-001',
  origin: 'CDF',
  destination: 'MAN',
  originName: 'Cardiff Central',
  destinationName: 'Manchester Piccadilly',
  travelDate: '2026-03-20',
  departureTime: '08:05',
  ticketType: 'off-peak',
  ticketClass: 'standard',
  farePence: 9800,
  matchedRoute: {
    legs: [
      {
        from: 'Cardiff Central',
        to: 'Manchester Piccadilly',
        departure: '08:05',
        arrival: '11:25',
        operator: '1:AW',
        tripId: '1:202603207701234',
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
          departure: '08:05',
          arrival: '11:25',
          operator: '1:AW',
          tripId: '1:202603207701234',
        },
      ],
      totalDuration: '3h 20m',
      isDirect: true,
    },
  ],
  isDirect: true,
};

/**
 * Two-leg OCR journey: Bristol Temple Meads → Birmingham New Street → Leeds
 * Leg 1: BRI → BHM  departs 09:10  arrives 10:48
 * Leg 2: BHM → LDS  departs 11:06  arrives 12:44
 *
 * Layover = 11:06 − 10:48 = 18 minutes
 * With default PLATFORM_DISCOUNT=3: connectionThresholdMinutes = 18 − 3 = 15
 * With custom  PLATFORM_DISCOUNT=5: connectionThresholdMinutes = 18 − 5 = 13
 */
const twoLegOcrStateData = {
  scan_id: 'scan-bl181-twoleg-002',
  image_gcs_path: 'gs://railrepay-tickets-prod/user-bl181-001/scan-bl181-twoleg-002.jpg',
  journeyId: 'journey-bl181-twoleg-002',
  origin: 'BRI',
  destination: 'LDS',
  originName: 'Bristol Temple Meads',
  destinationName: 'Leeds',
  travelDate: '2026-03-25',
  departureTime: '09:10',
  ticketType: 'advance',
  ticketClass: 'standard',
  farePence: 6700,
  matchedRoute: {
    legs: [
      {
        from: 'Bristol Temple Meads',
        to: 'Birmingham New Street',
        departure: '09:10',
        arrival: '10:48',
        operator: '1:XC',
        tripId: '1:202603257801001',
      },
      {
        from: 'Birmingham New Street',
        to: 'Leeds',
        departure: '11:06',
        arrival: '12:44',
        operator: '1:XC',
        tripId: '1:202603257801002',
      },
    ],
    totalDuration: '3h 34m',
    isDirect: false,
  },
  allRoutes: [
    {
      legs: [
        {
          from: 'Bristol Temple Meads',
          to: 'Birmingham New Street',
          departure: '09:10',
          arrival: '10:48',
          operator: '1:XC',
          tripId: '1:202603257801001',
        },
        {
          from: 'Birmingham New Street',
          to: 'Leeds',
          departure: '11:06',
          arrival: '12:44',
          operator: '1:XC',
          tripId: '1:202603257801002',
        },
      ],
      totalDuration: '3h 34m',
      isDirect: false,
    },
  ],
  isDirect: false,
};

/**
 * Three-leg OCR journey: Exeter St Davids → Bristol TM → Birmingham NS → Manchester Piccadilly
 * Leg 1: EXD → BRI  departs 07:00  arrives 07:58
 * Leg 2: BRI → BHM  departs 08:15  arrives 09:52
 * Leg 3: BHM → MAN  departs 10:10  arrives 11:50
 *
 * First connection layover = 08:15 − 07:58 = 17 minutes
 * With default PLATFORM_DISCOUNT=3: connectionThresholdMinutes = 17 − 3 = 14
 *
 * (Only the first connection's threshold is expected in the payload for MVP.)
 */
const threeLegOcrStateData = {
  scan_id: 'scan-bl181-threeleg-003',
  image_gcs_path: 'gs://railrepay-tickets-prod/user-bl181-001/scan-bl181-threeleg-003.jpg',
  journeyId: 'journey-bl181-threeleg-003',
  origin: 'EXD',
  destination: 'MAN',
  originName: 'Exeter St Davids',
  destinationName: 'Manchester Piccadilly',
  travelDate: '2026-03-28',
  departureTime: '07:00',
  ticketType: 'off-peak',
  ticketClass: 'standard',
  farePence: 14200,
  matchedRoute: {
    legs: [
      {
        from: 'Exeter St Davids',
        to: 'Bristol Temple Meads',
        departure: '07:00',
        arrival: '07:58',
        operator: '1:GW',
        tripId: '1:202603287901001',
      },
      {
        from: 'Bristol Temple Meads',
        to: 'Birmingham New Street',
        departure: '08:15',
        arrival: '09:52',
        operator: '1:XC',
        tripId: '1:202603287901002',
      },
      {
        from: 'Birmingham New Street',
        to: 'Manchester Piccadilly',
        departure: '10:10',
        arrival: '11:50',
        operator: '1:VT',
        tripId: '1:202603287901003',
      },
    ],
    totalDuration: '4h 50m',
    isDirect: false,
  },
  allRoutes: [
    {
      legs: [
        {
          from: 'Exeter St Davids',
          to: 'Bristol Temple Meads',
          departure: '07:00',
          arrival: '07:58',
          operator: '1:GW',
          tripId: '1:202603287901001',
        },
        {
          from: 'Bristol Temple Meads',
          to: 'Birmingham New Street',
          departure: '08:15',
          arrival: '09:52',
          operator: '1:XC',
          tripId: '1:202603287901002',
        },
        {
          from: 'Birmingham New Street',
          to: 'Manchester Piccadilly',
          departure: '10:10',
          arrival: '11:50',
          operator: '1:VT',
          tripId: '1:202603287901003',
        },
      ],
      totalDuration: '4h 50m',
      isDirect: false,
    },
  ],
  isDirect: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOcrContext(stateData: Record<string, unknown>): HandlerContext {
  return {
    phoneNumber: '+447700900771',
    messageBody: 'YES',
    messageSid: 'SM-bl181-test',
    user: mockUser,
    currentState: FSMState.AWAITING_JOURNEY_CONFIRM,
    correlationId: 'corr-bl181-subtask3',
    stateData,
  };
}

// ---------------------------------------------------------------------------
// AC-6: connectionThresholdMinutes in journey.confirmed payload
// ---------------------------------------------------------------------------

describe('BL-181 Sub-task 3 — AC-6: connectionThresholdMinutes in journey.confirmed payload', () => {
  beforeEach(() => {
    // Remove any custom discount set by AC-7 tests so AC-6 tests always use default
    delete process.env.PLATFORM_DISCOUNT_MINUTES;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.PLATFORM_DISCOUNT_MINUTES;
  });

  // -------------------------------------------------------------------------
  // AC-6a: Single-leg journey → connectionThresholdMinutes is null
  // -------------------------------------------------------------------------

  describe('AC-6 single-leg journey: connectionThresholdMinutes must be null', () => {
    it('should set connectionThresholdMinutes to null for a single-leg OCR journey', async () => {
      // AC-6: No connection exists in a direct single-leg journey; threshold is not applicable.
      const ctx = makeOcrContext({ ...singleLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents!.length).toBe(1);

      const payload = result.publishEvents![0].payload;
      expect(payload).toHaveProperty('connectionThresholdMinutes');
      expect(payload.connectionThresholdMinutes).toBeNull();
    });

    it('should publish the journey.confirmed event for a single-leg OCR journey', async () => {
      // AC-6: Presence of connectionThresholdMinutes must not suppress event publication.
      const ctx = makeOcrContext({ ...singleLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      expect(result.publishEvents![0].event_type).toBe('journey.confirmed');
    });
  });

  // -------------------------------------------------------------------------
  // AC-6b: Two-leg journey → connectionThresholdMinutes is calculated
  // -------------------------------------------------------------------------

  describe('AC-6 two-leg journey: connectionThresholdMinutes is calculated from ADR-021 formula', () => {
    it('should include connectionThresholdMinutes in the payload for a two-leg journey', async () => {
      // AC-6: Field must be present and non-null when at least two legs exist.
      const ctx = makeOcrContext({ ...twoLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      const payload = result.publishEvents![0].payload;
      expect(payload).toHaveProperty('connectionThresholdMinutes');
      expect(payload.connectionThresholdMinutes).not.toBeNull();
    });

    it('should calculate connectionThresholdMinutes using (layover - PLATFORM_DISCOUNT) for two-leg journey', async () => {
      // AC-6 formula verification:
      //   BHM departs 11:06, BRI arrives 10:48 → layover = 18 min
      //   PLATFORM_DISCOUNT default = 3 → threshold = 18 - 3 = 15 minutes
      const ctx = makeOcrContext({ ...twoLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      const payload = result.publishEvents![0].payload;
      expect(payload.connectionThresholdMinutes).toBe(15);
    });

    it('should set connectionThresholdMinutes as a number (not string) for two-leg journey', async () => {
      // AC-6: Downstream consumers (delay-tracker) expect a numeric value.
      const ctx = makeOcrContext({ ...twoLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      expect(typeof result.publishEvents![0].payload.connectionThresholdMinutes).toBe('number');
    });

    it('should not alter other required payload fields when adding connectionThresholdMinutes', async () => {
      // AC-6: Adding the new field must not break existing payload fields from TD-WHATSAPP-063.
      const ctx = makeOcrContext({ ...twoLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      const payload = result.publishEvents![0].payload;
      expect(payload.journey_id).toBeDefined();
      expect(payload.user_id).toBe('user-bl181-001');
      expect(payload.origin_crs).toBe('BRI');
      expect(payload.destination_crs).toBe('LDS');
      expect(payload.departure_datetime).toContain('2026-03-25');
      expect(payload.segments).toBeDefined();
      expect(Array.isArray(payload.segments)).toBe(true);
      expect(payload.segments.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // AC-6c: Three-leg journey → uses FIRST connection's threshold
  // -------------------------------------------------------------------------

  describe('AC-6 three-leg journey: connectionThresholdMinutes uses the first connection', () => {
    it('should calculate connectionThresholdMinutes from the first connection for a three-leg journey', async () => {
      // AC-6 formula verification (first connection):
      //   BRI departs 08:15, EXD arrives 07:58 → layover = 17 min
      //   PLATFORM_DISCOUNT default = 3 → threshold = 17 - 3 = 14 minutes
      const ctx = makeOcrContext({ ...threeLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      const payload = result.publishEvents![0].payload;
      expect(payload.connectionThresholdMinutes).toBe(14);
    });

    it('should include connectionThresholdMinutes as a number for a three-leg journey', async () => {
      // AC-6: Field type must be numeric regardless of leg count.
      const ctx = makeOcrContext({ ...threeLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      expect(typeof result.publishEvents![0].payload.connectionThresholdMinutes).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // AC-6d: Single-leg vs multi-leg produce different connectionThresholdMinutes values
  // -------------------------------------------------------------------------

  describe('AC-6 differentiation: single-leg null vs multi-leg number', () => {
    it('should produce different connectionThresholdMinutes for single-leg vs two-leg journey', async () => {
      // AC-6: The field must distinguish between direct and connecting journeys.
      const singleCtx = makeOcrContext({ ...singleLegOcrStateData });
      const twoLegCtx = makeOcrContext({ ...twoLegOcrStateData });

      const singleResult = await journeyConfirmHandler(singleCtx);
      const twoLegResult = await journeyConfirmHandler(twoLegCtx);

      const singleThreshold = singleResult.publishEvents![0].payload.connectionThresholdMinutes;
      const twoLegThreshold = twoLegResult.publishEvents![0].payload.connectionThresholdMinutes;

      expect(singleThreshold).toBeNull();
      expect(twoLegThreshold).not.toBeNull();
      expect(typeof twoLegThreshold).toBe('number');
    });
  });
});

// ---------------------------------------------------------------------------
// AC-7: PLATFORM_DISCOUNT_MINUTES env var controls the discount
// ---------------------------------------------------------------------------

describe('BL-181 Sub-task 3 — AC-7: PLATFORM_DISCOUNT_MINUTES env var', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env state after each test to prevent leakage between tests
    delete process.env.PLATFORM_DISCOUNT_MINUTES;
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // AC-7a: Default value is 3 minutes when env var is not set
  // -------------------------------------------------------------------------

  describe('AC-7 default: uses 3-minute discount when PLATFORM_DISCOUNT_MINUTES is unset', () => {
    it('should apply the default 3-minute platform discount when env var is absent', async () => {
      // AC-7: Default PLATFORM_DISCOUNT = 3
      // Two-leg fixture: layover = 18 min → threshold = 18 − 3 = 15
      delete process.env.PLATFORM_DISCOUNT_MINUTES;

      const ctx = makeOcrContext({ ...twoLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      expect(result.publishEvents![0].payload.connectionThresholdMinutes).toBe(15);
    });

    it('should apply the default 3-minute platform discount when env var is empty string', async () => {
      // AC-7: Empty string is treated as absent; default 3 applies.
      process.env.PLATFORM_DISCOUNT_MINUTES = '';

      const ctx = makeOcrContext({ ...twoLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      // Layover 18 min − discount 3 = 15
      expect(result.publishEvents![0].payload.connectionThresholdMinutes).toBe(15);
    });
  });

  // -------------------------------------------------------------------------
  // AC-7b: Custom env var value is used in the calculation
  // -------------------------------------------------------------------------

  describe('AC-7 custom: uses PLATFORM_DISCOUNT_MINUTES when set', () => {
    it('should apply a custom 5-minute platform discount when PLATFORM_DISCOUNT_MINUTES=5', async () => {
      // AC-7: When PLATFORM_DISCOUNT_MINUTES=5, two-leg: 18 − 5 = 13
      process.env.PLATFORM_DISCOUNT_MINUTES = '5';

      const ctx = makeOcrContext({ ...twoLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      expect(result.publishEvents![0].payload.connectionThresholdMinutes).toBe(13);
    });

    it('should apply a custom 0-minute platform discount when PLATFORM_DISCOUNT_MINUTES=0', async () => {
      // AC-7: When PLATFORM_DISCOUNT_MINUTES=0, threshold equals the raw layover time.
      // Two-leg: layover = 18 min → threshold = 18 − 0 = 18
      process.env.PLATFORM_DISCOUNT_MINUTES = '0';

      const ctx = makeOcrContext({ ...twoLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      expect(result.publishEvents![0].payload.connectionThresholdMinutes).toBe(18);
    });

    it('should apply a custom 10-minute platform discount for three-leg journey', async () => {
      // AC-7: Three-leg first connection layover = 17 min; discount 10 → threshold = 7
      process.env.PLATFORM_DISCOUNT_MINUTES = '10';

      const ctx = makeOcrContext({ ...threeLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      expect(result.publishEvents![0].payload.connectionThresholdMinutes).toBe(7);
    });

    it('should produce different thresholds for discount=3 vs discount=5 using same journey data', async () => {
      // AC-7: Changing the env var changes the result; confirms the var is actually read at call time.
      // Two-leg fixture: layover = 18 min
      process.env.PLATFORM_DISCOUNT_MINUTES = '3';
      const ctx3 = makeOcrContext({ ...twoLegOcrStateData });
      const result3 = await journeyConfirmHandler(ctx3);

      process.env.PLATFORM_DISCOUNT_MINUTES = '5';
      const ctx5 = makeOcrContext({ ...twoLegOcrStateData });
      const result5 = await journeyConfirmHandler(ctx5);

      expect(result3.publishEvents![0].payload.connectionThresholdMinutes).toBe(15);
      expect(result5.publishEvents![0].payload.connectionThresholdMinutes).toBe(13);
      expect(result3.publishEvents![0].payload.connectionThresholdMinutes).not.toBe(
        result5.publishEvents![0].payload.connectionThresholdMinutes
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC-7c: Single-leg is not affected by PLATFORM_DISCOUNT_MINUTES value
  // -------------------------------------------------------------------------

  describe('AC-7 single-leg invariance: discount env var does not change null for single-leg journey', () => {
    it('should still return connectionThresholdMinutes=null for single-leg regardless of PLATFORM_DISCOUNT_MINUTES', async () => {
      // AC-7: Discount is irrelevant when there is no connection; null must remain null.
      process.env.PLATFORM_DISCOUNT_MINUTES = '10';

      const ctx = makeOcrContext({ ...singleLegOcrStateData });
      const result = await journeyConfirmHandler(ctx);

      expect(result.publishEvents![0].payload.connectionThresholdMinutes).toBeNull();
    });
  });
});
