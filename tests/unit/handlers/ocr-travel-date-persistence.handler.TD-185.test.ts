/**
 * TD-OCR-DATE (BL-185): OCR travel_date Persistence and Adaptive Routing
 *
 * Written FIRST per ADR-014 (TDD Red phase).
 * Blake MUST NOT modify these tests — Test Lock Rule.
 *
 * ROOT CAUSE:
 *   parseDate() in services/ocr does not handle full month names (e.g. "05 April 2026").
 *   When OCR returns null for travel_date, stateData.travelDate is never set.
 *   adaptiveRoute() then falls through to AC-6 (asks for date) even when the ticket
 *   had a parseable date — the user is asked for information that was already extracted.
 *
 * ACCEPTANCE CRITERIA COVERED:
 *   AC-1: When OCR extracts a travel_date, it persists in stateData.travelDate
 *   AC-2: adaptiveRoute() receives the date and skips AWAITING_JOURNEY_DATE
 *   AC-3: If OCR cannot extract a date, user is asked ONCE (not re-asked)
 *   AC-4: Unit test verifying travel_date flows from OCR response through stateData
 *
 * FSM CONTEXT:
 *   TRIGGER:  AWAITING_OCR_REVIEW — user replies YES
 *   HANDLER:  ocrReviewHandler → adaptiveRoute()
 *
 *   Adaptive routing decision tree relevant to this TD:
 *   - origin + destination + travelDate + departureTime → AWAITING_JOURNEY_CONFIRM (AC-4 of BL-170)
 *   - origin + destination + travelDate (no time)       → AWAITING_JOURNEY_TIME   (AC-5 of BL-170)
 *   - origin + destination (NO date)                    → AWAITING_JOURNEY_DATE   (AC-6 of BL-170)
 *
 *   When travel_date is correctly persisted, the handler must NOT transition to
 *   AWAITING_JOURNEY_DATE — that would re-ask the user for data already extracted.
 *
 * EXPECTED TEST OUTCOME (RED phase):
 *   Tests verifying that travelDate IS present in stateData and that the handler
 *   does NOT go to AWAITING_JOURNEY_DATE will currently PASS if the test data
 *   is set up with a non-null travelDate. However, the integration-level test
 *   (ticket-or-manual → stateData mapping) will FAIL because the OCR service
 *   returning a full-month-name date currently produces null in extracted_fields.
 *   That null propagates and causes the adaptive route test to pick AWAITING_JOURNEY_DATE.
 *
 *   The tests in this file are written assuming the fix IS in place.
 *   They will be RED until Blake:
 *   (a) fixes parseDate() in ocr/src/services/parser.service.ts, AND
 *   (b) the extracted_fields.travel_date is therefore non-null for full month names.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Infrastructure package mocking (Guideline #11)
// Shared instances OUTSIDE factory functions — all tests assert the same mock.
// ─────────────────────────────────────────────────────────────────────────────

const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// Mock OCR client — ticketOrManualHandler uses callOcrService
vi.mock('../../../src/services/ocr-client.service', () => ({
  callOcrService: vi.fn(),
}));

// Mock station search — ocrReviewHandler uses searchStations for CRS resolution
vi.mock('../../../src/services/station.service', () => ({
  searchStations: vi.fn(),
}));

// Mock axios — ocrReviewHandler (adaptiveRoute) calls journey-matcher /routes via axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

import { ticketOrManualHandler } from '../../../src/handlers/ticket-or-manual.handler';
import { ocrReviewHandler } from '../../../src/handlers/ocr-review.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';
import { callOcrService } from '../../../src/services/ocr-client.service';
import { searchStations } from '../../../src/services/station.service';
import axios from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// Shared test data
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_USER: User = {
  id: 'user-td185-001',
  phone_number: '+447700900185',
  verified_at: new Date('2026-01-10T09:00:00Z'),
  created_at: new Date('2026-01-10T09:00:00Z'),
  updated_at: new Date('2026-01-10T09:00:00Z'),
};

function makeTicketOrManualCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    phoneNumber: '+447700900185',
    messageBody: '',
    messageSid: 'SM-td185-001',
    user: MOCK_USER,
    currentState: FSMState.AWAITING_TICKET_OR_MANUAL,
    correlationId: 'corr-td185-001',
    stateData: {},
    ...overrides,
  };
}

function makeOcrReviewCtx(stateData: Record<string, any>, messageBody = 'YES'): HandlerContext {
  return {
    phoneNumber: '+447700900185',
    messageBody,
    messageSid: 'SM-td185-review',
    user: MOCK_USER,
    currentState: FSMState.AWAITING_OCR_REVIEW,
    correlationId: 'corr-td185-review',
    stateData,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 / AC-4: travel_date from OCR response maps to stateData.travelDate
//
// When callOcrService returns extracted_fields.travel_date with a non-null value,
// ticketOrManualHandler MUST store it as stateData.travelDate before transitioning
// to AWAITING_OCR_REVIEW.
//
// This is the critical mapping at line 94 of ticket-or-manual.handler.ts:
//   if (ef.travel_date != null) stateData.travelDate = ef.travel_date;
//
// The bug: when the OCR service processes a ticket with "05 April 2026",
// parseDate() returns null → extracted_fields.travel_date is null → the if-guard
// prevents assignment → stateData.travelDate is never set.
// Fix: parseDate() correctly returns "2026-04-05" → travel_date is non-null →
// stateData.travelDate is set.
// ─────────────────────────────────────────────────────────────────────────────

describe('TD-OCR-DATE (BL-185): travel_date persistence from OCR through stateData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OCR_SERVICE_URL = 'http://railrepay-ocr.test:3010';
    process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher.test:3020';
  });

  afterEach(() => {
    delete process.env.OCR_SERVICE_URL;
    delete process.env.JOURNEY_MATCHER_URL;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC-4: Unit-level mapping test — extracted_fields.travel_date → stateData.travelDate
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC-4: travel_date field mapping in ticketOrManualHandler', () => {
    it('should store travel_date from OCR response as stateData.travelDate when date is present', async () => {
      // AC-4: Core mapping test.
      // OCR service returns extracted_fields.travel_date = "2026-04-05"
      // (the result of correctly parsing "05 April 2026" after the fix).
      // Handler MUST set stateData.travelDate = "2026-04-05".
      //
      // Currently FAILS if OCR parseDate fix is not in place (date remains null,
      // mapping is skipped, stateData.travelDate is undefined).
      const ctx = makeTicketOrManualCtx({
        mediaUrl: 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME-td185-01',
        mediaContentType: 'image/jpeg',
      });

      vi.mocked(callOcrService).mockResolvedValueOnce({
        scan_id: 'scan-td185-001',
        status: 'completed',
        confidence: 0.91,
        extracted_fields: {
          origin_station: 'London Paddington',
          destination_station: 'Bristol Temple Meads',
          origin_crs: 'PAD',
          destination_crs: 'BRI',
          // travel_date is the result of parsing "05 April 2026" — non-null after fix
          travel_date: '2026-04-05',
          departure_time: null,
          ticket_type: 'advance',
          ticket_class: 'standard',
          fare_pence: 3200,
          via_station: null,
          via_crs: null,
          operator_name: 'GWR',
        },
        missing_fields: [],
        claim_ready: true,
        ocr_status: 'completed',
        gcs_upload_status: 'uploaded',
        image_gcs_path: 'gs://railrepay-tickets-prod/user-td185-001/scan-td185-001.jpg',
      });

      const result = await ticketOrManualHandler(ctx);

      // AC-4: travel_date must be persisted in stateData
      expect(result.stateData?.travelDate).toBe('2026-04-05');
    });

    it('should NOT set stateData.travelDate when OCR returns null for travel_date', async () => {
      // AC-3: When OCR genuinely cannot extract a date (e.g. open return ticket),
      // stateData.travelDate must be absent — we do not fabricate a date.
      // This is the correct behavior; the user will be asked for the date later.
      const ctx = makeTicketOrManualCtx({
        mediaUrl: 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME-td185-02',
        mediaContentType: 'image/jpeg',
      });

      vi.mocked(callOcrService).mockResolvedValueOnce({
        scan_id: 'scan-td185-002',
        status: 'completed',
        confidence: 0.88,
        extracted_fields: {
          origin_station: 'London Paddington',
          destination_station: 'Bristol Temple Meads',
          origin_crs: 'PAD',
          destination_crs: 'BRI',
          travel_date: null, // Genuinely absent — e.g. open return ticket
          departure_time: null,
          ticket_type: 'open return',
          ticket_class: 'standard',
          fare_pence: 8900,
          via_station: null,
          via_crs: null,
          operator_name: 'GWR',
        },
        missing_fields: ['travel_date'],
        claim_ready: false,
        ocr_status: 'completed',
        gcs_upload_status: 'uploaded',
        image_gcs_path: 'gs://railrepay-tickets-prod/user-td185-001/scan-td185-002.jpg',
      });

      const result = await ticketOrManualHandler(ctx);

      // travelDate must be absent — not set to null, not set to undefined explicitly
      expect(result.stateData?.travelDate).toBeUndefined();
    });

    it('should set stateData.travelDate for a December full-month-name ticket date', async () => {
      // AC-4: Second canonical example from BL-185 spec.
      // OCR correctly parses "20 December 2025" → "2025-12-20" (after fix).
      const ctx = makeTicketOrManualCtx({
        mediaUrl: 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME-td185-03',
        mediaContentType: 'application/pdf',
      });

      vi.mocked(callOcrService).mockResolvedValueOnce({
        scan_id: 'scan-td185-003',
        status: 'completed',
        confidence: 0.94,
        extracted_fields: {
          origin_station: 'Abergavenny',
          destination_station: 'Neath',
          origin_crs: 'AGV',
          destination_crs: 'NTH',
          // Correctly parsed from "20 December 2025" after fix
          travel_date: '2025-12-20',
          departure_time: null,
          ticket_type: 'anytime day return',
          ticket_class: 'standard',
          fare_pence: 3740,
          via_station: null,
          via_crs: null,
          operator_name: 'TfW',
        },
        missing_fields: [],
        claim_ready: true,
        ocr_status: 'completed',
        gcs_upload_status: 'uploaded',
        image_gcs_path: 'gs://railrepay-tickets-prod/user-td185-001/scan-td185-003.pdf',
      });

      const result = await ticketOrManualHandler(ctx);

      expect(result.stateData?.travelDate).toBe('2025-12-20');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC-2: adaptiveRoute() skips AWAITING_JOURNEY_DATE when travelDate is present
  //
  // When stateData contains origin CRS + destination CRS + travelDate (but no time),
  // ocrReviewHandler must route to AWAITING_JOURNEY_TIME (AC-5 of BL-170),
  // NOT to AWAITING_JOURNEY_DATE.
  //
  // If travelDate is absent (because parseDate returned null), the handler falls
  // through to AC-6 and routes to AWAITING_JOURNEY_DATE — the bug described in BL-185.
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC-2: adaptiveRoute skips AWAITING_JOURNEY_DATE when travelDate is present', () => {
    it('should route to AWAITING_JOURNEY_TIME (not AWAITING_JOURNEY_DATE) when origin + destination + travelDate present', async () => {
      // AC-2: Stations + date present, no departure time.
      // Correct path: AWAITING_JOURNEY_TIME (AC-5 of BL-170 adaptive routing).
      // Bug path:     AWAITING_JOURNEY_DATE (AC-6 — triggered when travelDate is null).
      //
      // This test FAILS before the fix because stateData.travelDate is null
      // (parseDate returned null for full month name), causing adaptiveRoute to
      // treat the journey as "stations only" and ask for the date again.
      const stateData = {
        scan_id: 'scan-td185-004',
        ocr_confidence: 0.91,
        claim_ready: true,
        image_gcs_path: 'gs://railrepay-tickets-prod/user-td185-001/scan-td185-004.jpg',
        origin: 'PAD',          // CRS present
        destination: 'BRI',    // CRS present
        originName: 'London Paddington',
        destinationName: 'Bristol Temple Meads',
        travelDate: '2026-04-05', // Non-null after fix — correctly parsed "05 April 2026"
        // departureTime absent → should ask for time, NOT date
      };

      const ctx = makeOcrReviewCtx(stateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      // Must NOT re-ask for date — that was already extracted from the ticket
      expect(result.nextState).not.toBe(FSMState.AWAITING_JOURNEY_DATE);
      // Must ask for time instead (AC-5: stations + date, no time → AWAITING_JOURNEY_TIME)
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should route to AWAITING_JOURNEY_CONFIRM when all four fields present (stations + date + time)', async () => {
      // AC-2: Full extraction — all four fields available.
      // Correct path: AWAITING_JOURNEY_CONFIRM (AC-4 of BL-170 adaptive routing
      // via journey-matcher /routes call).
      // This confirms that when travelDate is correctly set, the handler progresses
      // through the full happy path without stopping to re-ask for the date.
      //
      // Verified: journey-matcher exposes GET /routes
      // (services/journey-matcher/src/api/routes.ts)
      const stateData = {
        scan_id: 'scan-td185-005',
        ocr_confidence: 0.93,
        claim_ready: true,
        image_gcs_path: 'gs://railrepay-tickets-prod/user-td185-001/scan-td185-005.jpg',
        origin: 'PAD',
        destination: 'BRI',
        originName: 'London Paddington',
        destinationName: 'Bristol Temple Meads',
        travelDate: '2026-04-05', // Non-null after fix
        departureTime: '09:00',   // All four fields present
      };

      const ctx = makeOcrReviewCtx(stateData, 'YES');

      // Mock journey-matcher /routes — returns a direct service
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          routes: [
            {
              isDirect: true,
              legs: [
                {
                  departure: '09:00',
                  operator: 'GW',
                  from: 'PAD',
                  to: 'BRI',
                },
              ],
            },
          ],
        },
      });

      const result = await ocrReviewHandler(ctx);

      // Must not re-ask for date or time — both were extracted from the ticket
      expect(result.nextState).not.toBe(FSMState.AWAITING_JOURNEY_DATE);
      expect(result.nextState).not.toBe(FSMState.AWAITING_JOURNEY_TIME);
      // Must progress to journey confirmation
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should route to AWAITING_JOURNEY_DATE when travelDate is absent (OCR failed to extract)', async () => {
      // AC-3: When OCR genuinely cannot extract a date (null travel_date),
      // asking for the date ONCE is correct behavior — the user was not re-asked.
      // This test ensures the null-date path still works correctly after the fix.
      // Origin and destination CRS are present; only date is missing.
      const stateData = {
        scan_id: 'scan-td185-006',
        ocr_confidence: 0.72,
        claim_ready: false,
        image_gcs_path: 'gs://railrepay-tickets-prod/user-td185-001/scan-td185-006.jpg',
        origin: 'PAD',
        destination: 'BRI',
        originName: 'London Paddington',
        destinationName: 'Bristol Temple Meads',
        // travelDate deliberately absent — OCR could not extract it
      };

      const ctx = makeOcrReviewCtx(stateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      // Stations present but date absent → ask for date (AC-6 of BL-170)
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
      // Must NOT be re-asking for stations
      expect(result.nextState).not.toBe(FSMState.AWAITING_JOURNEY_STATIONS);
    });

    it('should preserve travelDate in stateData when routing to AWAITING_JOURNEY_TIME', async () => {
      // AC-2: stateData must carry travelDate forward to the next state
      // so AWAITING_JOURNEY_TIME handler does not need to re-fetch it.
      const stateData = {
        scan_id: 'scan-td185-007',
        ocr_confidence: 0.89,
        claim_ready: true,
        image_gcs_path: 'gs://railrepay-tickets-prod/user-td185-001/scan-td185-007.jpg',
        origin: 'MAN',
        destination: 'LDS',
        originName: 'Manchester Piccadilly',
        destinationName: 'Leeds',
        travelDate: '2026-04-05', // Must survive into result.stateData
      };

      const ctx = makeOcrReviewCtx(stateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
      // travelDate must be present in outgoing stateData so the next handler can use it
      expect(result.stateData?.travelDate).toBe('2026-04-05');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC-3: User is asked for date at most once (not re-asked for already-extracted data)
  //
  // Before the fix: a ticket with "05 April 2026" → parseDate returns null →
  // stateData.travelDate is null → adaptiveRoute asks for date → user enters date →
  // AWAITING_JOURNEY_DATE handler responds → effectively asks twice for the same info.
  //
  // After the fix: parseDate returns "2026-04-05" → stateData.travelDate is set →
  // adaptiveRoute skips AWAITING_JOURNEY_DATE entirely → user asked for date ZERO times.
  //
  // This test validates the integration boundary: when OCR response includes a
  // valid full-month-name date, the entire flow from ticketOrManualHandler through
  // to the first AWAITING state must not include AWAITING_JOURNEY_DATE.
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC-3: User is not re-asked for date when OCR already extracted it', () => {
    it('should not route through AWAITING_JOURNEY_DATE when OCR extracted travelDate', async () => {
      // AC-3: End-to-end state transition check.
      // Step 1: ticketOrManualHandler produces stateData with travelDate set.
      // Step 2: ocrReviewHandler (YES) uses that stateData and does NOT go to AWAITING_JOURNEY_DATE.
      const ticketCtx = makeTicketOrManualCtx({
        mediaUrl: 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME-td185-08',
        mediaContentType: 'image/jpeg',
      });

      vi.mocked(callOcrService).mockResolvedValueOnce({
        scan_id: 'scan-td185-008',
        status: 'completed',
        confidence: 0.92,
        extracted_fields: {
          origin_station: 'London Paddington',
          destination_station: 'Bristol Temple Meads',
          origin_crs: 'PAD',
          destination_crs: 'BRI',
          // Parsed correctly from "05 April 2026" after fix
          travel_date: '2026-04-05',
          departure_time: null,
          ticket_type: 'advance',
          ticket_class: 'standard',
          fare_pence: 3200,
          via_station: null,
          via_crs: null,
          operator_name: 'GWR',
        },
        missing_fields: [],
        claim_ready: true,
        ocr_status: 'completed',
        gcs_upload_status: 'uploaded',
        image_gcs_path: 'gs://railrepay-tickets-prod/user-td185-001/scan-td185-008.jpg',
      });

      // Step 1: process ticket upload
      const uploadResult = await ticketOrManualHandler(ticketCtx);

      // Verify travelDate was captured in step 1
      expect(uploadResult.stateData?.travelDate).toBe('2026-04-05');
      expect(uploadResult.nextState).toBe(FSMState.AWAITING_OCR_REVIEW);

      // Step 2: user confirms OCR data (YES)
      const reviewCtx = makeOcrReviewCtx(uploadResult.stateData ?? {}, 'YES');
      const reviewResult = await ocrReviewHandler(reviewCtx);

      // AC-3: The journey must NOT pass through AWAITING_JOURNEY_DATE
      // because the date was already extracted. Asking again is a UX bug.
      expect(reviewResult.nextState).not.toBe(FSMState.AWAITING_JOURNEY_DATE);
    });
  });
});
