/**
 * OCR Review Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * BL-167: TD-WHATSAPP-062-S1 — Core FSM + OCR Call + User Confirmation
 * BL-170: TD-WHATSAPP-062-S2 — Adaptive Extraction Routing
 * SPEC (S1): services/whatsapp-handler/docs/phases/TD-WHATSAPP-062-S1-SPECIFICATION.md
 * SPEC (S2): services/whatsapp-handler/docs/phases/TD-WHATSAPP-062-S2-SPECIFICATION.md
 * Per ADR-014: These tests define the behavior. Blake MUST NOT modify these tests.
 * Per Test Lock Rule: Blake MUST NOT modify these tests.
 *
 * State handled: AWAITING_OCR_REVIEW
 * Triggered from: AWAITING_TICKET_OR_MANUAL + successful OCR scan
 *
 * Test coverage:
 * - AC-10: Presents readable summary of extracted OCR fields
 * - AC-12: NO discards OCR data → transitions to AWAITING_JOURNEY_DATE with clean stateData
 * - AC-4:  Full extraction (all 4 fields) → auto route match → AWAITING_JOURNEY_CONFIRM
 * - AC-5:  Stations + date, no time → AWAITING_JOURNEY_TIME (stateData pre-filled)
 * - AC-6:  Stations only, no date → AWAITING_JOURNEY_DATE (stateData pre-filled with stations)
 * - AC-7:  Date only, no stations → AWAITING_JOURNEY_STATIONS (stateData pre-filled with date)
 * - AC-8:  Station names without CRS → CRS lookup via searchStations(), then re-evaluate
 * - AC-9:  No usable fields → AWAITING_JOURNEY_DATE with friendly fallback message
 *
 * NOTE on AC-11 from S1:
 * S1's AC-11 tested "YES → AWAITING_JOURNEY_DATE (always)". S2 supersedes that behavior
 * entirely: the YES branch now adaptively routes through AC-4 to AC-9. The unconditional
 * AWAITING_JOURNEY_DATE assertion is replaced by the per-scenario routing tests below.
 * This is not a Test Lock violation — Jessie is updating her own test specification.
 *
 * FSM TRIGGER:  AWAITING_TICKET_OR_MANUAL + media + OCR success → AWAITING_OCR_REVIEW
 * FSM OUTPUTS (S2 adaptive routing on YES):
 *   - All 4 fields present → /routes call → AWAITING_JOURNEY_CONFIRM        (AC-4)
 *   - origin + destination + travelDate (no time) → AWAITING_JOURNEY_TIME   (AC-5)
 *   - origin + destination (no date) → AWAITING_JOURNEY_DATE                (AC-6)
 *   - travelDate only (no stations) → AWAITING_JOURNEY_STATIONS             (AC-7)
 *   - station names, no CRS → lookup → re-evaluate                          (AC-8)
 *   - no usable fields → AWAITING_JOURNEY_DATE (fallback)                   (AC-9)
 *   - "NO" → AWAITING_JOURNEY_DATE (clean stateData)                        (AC-12)
 *   - other input → stay in AWAITING_OCR_REVIEW                             (invalid)
 *
 * Mocking:
 *   - @railrepay/winston-logger: shared mock instance (Section 6.1.11)
 *   - axios: mocked for journey-matcher /routes call (AC-4)
 *     Verified: journey-matcher service exposes GET /routes (pattern from journey-time.handler.ts)
 *   - ../../../src/services/station.service: mocked for CRS fallback (AC-8)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ocrReviewHandler } from '../../../src/handlers/ocr-review.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// ---------------------------------------------------------------------------
// Infrastructure package mocking per Section 6.1.11
// Shared logger instance OUTSIDE factory — ensures same instance across all tests
// ---------------------------------------------------------------------------
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
  Logger: class {},
}));

// ---------------------------------------------------------------------------
// axios mock for journey-matcher /routes call (AC-4)
// Verified: journey-matcher exposes GET /routes (journey-time.handler.ts line 76)
// ---------------------------------------------------------------------------
vi.mock('axios');
import axios from 'axios';

// ---------------------------------------------------------------------------
// station.service mock for CRS fallback (AC-8)
// ---------------------------------------------------------------------------
vi.mock('../../../src/services/station.service', () => ({
  searchStations: vi.fn(),
}));
import { searchStations } from '../../../src/services/station.service';

// ---------------------------------------------------------------------------
// Fixture definitions (from TD-WHATSAPP-062-S2 specification § Key stateData Fixtures)
// ---------------------------------------------------------------------------

/** AC-4: All four critical fields extracted — full extraction */
const fullExtractionStateData = {
  origin: 'PAD',
  destination: 'BRI',
  originName: 'London Paddington',
  destinationName: 'Bristol Temple Meads',
  travelDate: '2026-03-15',
  departureTime: '14:30',
  scan_id: 'scan-001',
  ocr_confidence: 0.91,
  image_gcs_path: 'gs://railrepay-tickets-prod/user-001/scan-001.jpg',
  claim_ready: true,
};

/** AC-5: origin + destination + travelDate, no departureTime */
const stationsAndDateStateData = {
  origin: 'PAD',
  destination: 'BRI',
  originName: 'London Paddington',
  destinationName: 'Bristol Temple Meads',
  travelDate: '2026-03-15',
  scan_id: 'scan-002',
  ocr_confidence: 0.85,
  image_gcs_path: 'gs://railrepay-tickets-prod/user-001/scan-002.jpg',
};

/** AC-6: origin + destination only, no travelDate, no departureTime */
const stationsOnlyStateData = {
  origin: 'MAN',
  destination: 'LDS',
  originName: 'Manchester Piccadilly',
  destinationName: 'Leeds',
  scan_id: 'scan-003',
  ocr_confidence: 0.70,
  image_gcs_path: 'gs://railrepay-tickets-prod/user-001/scan-003.jpg',
};

/** AC-7: travelDate only, no origin, no destination, no CRS codes */
const dateOnlyStateData = {
  travelDate: '2026-04-01',
  scan_id: 'scan-004',
  ocr_confidence: 0.40,
  image_gcs_path: 'gs://railrepay-tickets-prod/user-001/scan-004.jpg',
};

/** AC-8: station names without CRS codes (origin/destination absent) */
const stationNamesNoCrsStateData = {
  originName: 'London Paddington',
  destinationName: 'Bristol Temple Meads',
  travelDate: '2026-03-15',
  scan_id: 'scan-005',
  ocr_confidence: 0.60,
  image_gcs_path: 'gs://railrepay-tickets-prod/user-001/scan-005.jpg',
};

/** AC-9: No usable fields at all */
const noUsableFieldsStateData = {
  scan_id: 'scan-006',
  ocr_confidence: 0.15,
  image_gcs_path: 'gs://railrepay-tickets-prod/user-001/scan-006.jpg',
  claim_ready: false,
};

/** S1: Full OCR stateData (used for AC-10 / AC-12 / invalid input tests) */
const fullOcrStateData = {
  scan_id: 'scan-review-001',
  ocr_confidence: 0.91,
  claim_ready: true,
  image_gcs_path: 'gs://railrepay-tickets-prod/user-review-001/scan-review-001.jpg',
  origin: 'PAD',
  destination: 'BRI',
  originName: 'London Paddington',
  destinationName: 'Bristol Temple Meads',
  travelDate: '2026-03-15',
  departureTime: '14:30',
  ticketType: 'advance single',
  ticketClass: 'standard',
  farePence: 3500,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(): User {
  return {
    id: 'user-review-001',
    phone_number: '+447700900300',
    verified_at: new Date('2026-01-15T08:00:00Z'),
    created_at: new Date('2026-01-15T08:00:00Z'),
    updated_at: new Date('2026-01-15T08:00:00Z'),
  };
}

function makeContext(stateData: Record<string, any>, messageBody: string): HandlerContext {
  return {
    phoneNumber: '+447700900300',
    messageBody,
    messageSid: 'SMreview001',
    user: makeUser(),
    currentState: FSMState.AWAITING_OCR_REVIEW,
    correlationId: 'corr-review-001',
    stateData: { ...stateData },
  };
}

// ---------------------------------------------------------------------------
// Shared journey-matcher mock response helpers
// ---------------------------------------------------------------------------

function mockDirectRouteResponse() {
  const mockGet = vi.mocked(axios.get);
  mockGet.mockResolvedValueOnce({
    data: {
      routes: [
        {
          isDirect: true,
          legs: [
            {
              departure: '14:30',
              operator: 'GW',
              from: 'PAD',
              to: 'BRI',
            },
          ],
        },
      ],
    },
    status: 200,
  });
}

function mockInterchangeRouteResponse() {
  const mockGet = vi.mocked(axios.get);
  mockGet.mockResolvedValueOnce({
    data: {
      routes: [
        {
          isDirect: false,
          interchangeStation: 'Bristol Parkway',
          legs: [
            { departure: '14:30', operator: 'GW', from: 'PAD', to: 'Bristol Parkway' },
            { departure: '15:10', operator: 'GW', from: 'Bristol Parkway', to: 'BRI' },
          ],
        },
      ],
    },
    status: 200,
  });
}

function mockNoRoutesResponse() {
  const mockGet = vi.mocked(axios.get);
  mockGet.mockResolvedValueOnce({
    data: { routes: [] },
    status: 200,
  });
}

function mockAxiosTimeout() {
  const mockGet = vi.mocked(axios.get);
  const err = Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
  mockGet.mockRejectedValueOnce(err);
}

function mockAxios5xxError() {
  const mockGet = vi.mocked(axios.get);
  const err = Object.assign(new Error('Request failed with status code 503'), {
    response: { status: 503 },
  });
  mockGet.mockRejectedValueOnce(err);
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('TD-WHATSAPP-062-S1/S2: OCR Review Handler (AWAITING_OCR_REVIEW)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher:3000';
  });

  afterEach(() => {
    delete process.env.JOURNEY_MATCHER_URL;
  });

  // -------------------------------------------------------------------------
  // AC-10: Readable summary of extracted fields is presented to the user
  // -------------------------------------------------------------------------

  describe('AC-10: OCR extraction summary display', () => {
    it('should present a readable summary containing origin and destination when both are extracted', async () => {
      // AC-10: Summary must show extracted journey details before asking YES/NO
      const ctx = makeContext(fullOcrStateData, '');

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toContain('London Paddington');
      expect(result.response).toContain('Bristol Temple Meads');
      expect(result.nextState).toBe(FSMState.AWAITING_OCR_REVIEW);
    });

    it('should include the travel date in the summary when it was extracted', async () => {
      // AC-10: Show date field in readable format
      const ctx = makeContext(fullOcrStateData, '');

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toContain('2026-03-15');
    });

    it('should include the departure time in the summary when it was extracted', async () => {
      // AC-10: Show time field
      const ctx = makeContext(fullOcrStateData, '');

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toContain('14:30');
    });

    it('should ask the user to confirm with YES or NO', async () => {
      // AC-10: Summary must end with a YES/NO confirmation prompt
      const ctx = makeContext(fullOcrStateData, '');

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toContain('YES');
      expect(result.response).toContain('NO');
    });

    it('should still show a summary when only partial fields were extracted', async () => {
      // AC-10: Even few fields extracted → show what was found, ask for confirmation
      const partialStateData = {
        scan_id: 'scan-partial-001',
        ocr_confidence: 0.45,
        claim_ready: false,
        image_gcs_path: 'gs://railrepay-tickets-prod/user-review-001/scan-partial-001.jpg',
        origin: 'MAN',
        originName: 'Manchester Piccadilly',
        travelDate: '2026-04-10',
      };

      const ctx = makeContext(partialStateData, '');

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toContain('Manchester Piccadilly');
      expect(result.response).toContain('2026-04-10');
      expect(result.response).toContain('YES');
      expect(result.response).toContain('NO');
      expect(result.nextState).toBe(FSMState.AWAITING_OCR_REVIEW);
    });

    it('should NOT show null or undefined fields in the summary', async () => {
      // AC-10: Only show fields that were actually extracted (non-null)
      const stateDataWithNulls = {
        ...fullOcrStateData,
        viaStation: null,
        viaCrs: null,
      };

      const ctx = makeContext(stateDataWithNulls, '');

      const result = await ocrReviewHandler(ctx);

      expect(result.response).not.toContain('null');
      expect(result.response).not.toContain('undefined');
    });
  });

  // -------------------------------------------------------------------------
  // AC-12: NO discards OCR data — transitions to AWAITING_JOURNEY_DATE with clean stateData
  // -------------------------------------------------------------------------

  describe('AC-12: NO rejection — discard OCR data, start manual flow', () => {
    it('should transition to AWAITING_JOURNEY_DATE when user sends "NO"', async () => {
      // AC-12: NO → discard OCR data, go to AWAITING_JOURNEY_DATE (same as MANUAL path)
      const ctx = makeContext(fullOcrStateData, 'NO');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should accept "no" (lowercase) and transition to AWAITING_JOURNEY_DATE', async () => {
      // AC-12: Case-insensitive NO
      const ctx = makeContext(fullOcrStateData, 'no');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should discard all OCR-extracted fields from stateData when user rejects with NO', async () => {
      // AC-12: NO path must produce clean stateData — no scan_id, no origin, no travelDate
      const ctx = makeContext(fullOcrStateData, 'NO');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.scan_id).toBeUndefined();
      expect(result.stateData?.ocr_confidence).toBeUndefined();
      expect(result.stateData?.origin).toBeUndefined();
      expect(result.stateData?.destination).toBeUndefined();
      expect(result.stateData?.travelDate).toBeUndefined();
      expect(result.stateData?.departureTime).toBeUndefined();
      expect(result.stateData?.image_gcs_path).toBeUndefined();
    });

    it('should send an encouraging message when user rejects OCR with NO', async () => {
      // AC-12: User should receive a friendly response when rejecting
      const ctx = makeContext(fullOcrStateData, 'NO');

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toMatch(/manually|details|journey|enter/i);
    });
  });

  // -------------------------------------------------------------------------
  // Invalid input — stay in AWAITING_OCR_REVIEW and re-prompt
  // -------------------------------------------------------------------------

  describe('Invalid input — stay in AWAITING_OCR_REVIEW', () => {
    it('should stay in AWAITING_OCR_REVIEW and re-show the summary when input is not YES or NO', async () => {
      // Non-YES/NO input: show summary again and ask for YES or NO
      const ctx = makeContext(fullOcrStateData, 'maybe');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_OCR_REVIEW);
      expect(result.response).toContain('YES');
      expect(result.response).toContain('NO');
    });
  });

  // -------------------------------------------------------------------------
  // AC-4: Full extraction → auto route match → AWAITING_JOURNEY_CONFIRM
  // Decision tree path: origin CRS + destination CRS + travelDate + departureTime
  // -------------------------------------------------------------------------

  describe('AC-4: Full extraction — auto route match', () => {
    it('should call journey-matcher /routes with extracted origin, destination, date, and time', async () => {
      // AC-4: All 4 fields present → call GET /routes
      mockDirectRouteResponse();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      await ocrReviewHandler(ctx);

      expect(vi.mocked(axios.get)).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(axios.get).mock.calls[0];
      expect(callArgs[0]).toContain('/routes');
      expect(callArgs[1]?.params).toMatchObject({
        from: 'PAD',
        to: 'BRI',
        date: '2026-03-15',
        time: '14:30',
      });
    });

    it('should transition to AWAITING_JOURNEY_CONFIRM when a direct route is found', async () => {
      // AC-4: Route found → present match, ask for confirmation
      mockDirectRouteResponse();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should include matched route in stateData when route is found', async () => {
      // AC-4: matchedRoute stored in stateData for journey-confirm handler
      mockDirectRouteResponse();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.matchedRoute).toBeDefined();
    });

    it('should preserve OCR metadata (scan_id, image_gcs_path) in stateData after route match', async () => {
      // AC-4: OCR metadata carried forward even after route match
      mockDirectRouteResponse();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.scan_id).toBe('scan-001');
      expect(result.stateData?.image_gcs_path).toBe(
        'gs://railrepay-tickets-prod/user-001/scan-001.jpg'
      );
    });

    it('should present a message asking the user to confirm the matched route', async () => {
      // AC-4: Response should describe the found service and ask YES/NO
      mockDirectRouteResponse();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toMatch(/YES|confirm/i);
      expect(result.response).toMatch(/NO|alternative/i);
    });

    it('should handle lowercase "yes" and still perform route matching', async () => {
      // AC-4: Case-insensitive YES
      mockDirectRouteResponse();
      const ctx = makeContext(fullExtractionStateData, 'yes');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
      expect(vi.mocked(axios.get)).toHaveBeenCalledOnce();
    });

    it('should transition to AWAITING_JOURNEY_CONFIRM for an interchange route', async () => {
      // AC-4: Interchange routes are also valid — still confirm, not just direct
      mockInterchangeRouteResponse();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
      expect(result.stateData?.isDirect).toBe(false);
    });

    // AC-4 error handling

    it('should fall back to AWAITING_JOURNEY_TIME when /routes returns no routes', async () => {
      // AC-4 error: no routes found → let user try a different time
      mockNoRoutesResponse();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should fall back to AWAITING_JOURNEY_TIME on route-matcher timeout', async () => {
      // AC-4 error: timeout → fall back gracefully, stateData preserved
      mockAxiosTimeout();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should preserve stateData (including OCR fields) on route-matcher timeout', async () => {
      // AC-4 error: even on timeout, origin/destination/travelDate must be preserved
      // so AWAITING_JOURNEY_TIME handler can proceed without re-prompting for stations/date
      mockAxiosTimeout();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.origin).toBe('PAD');
      expect(result.stateData?.destination).toBe('BRI');
      expect(result.stateData?.travelDate).toBe('2026-03-15');
      expect(result.stateData?.scan_id).toBe('scan-001');
    });

    it('should fall back to AWAITING_JOURNEY_TIME on route-matcher 5xx error', async () => {
      // AC-4 error: 5xx error → fall back gracefully
      mockAxios5xxError();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should preserve stateData (including OCR fields) on route-matcher 5xx error', async () => {
      // AC-4 error: stateData preserved even on 5xx
      mockAxios5xxError();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.origin).toBe('PAD');
      expect(result.stateData?.destination).toBe('BRI');
      expect(result.stateData?.travelDate).toBe('2026-03-15');
    });

    it('should NOT call /routes when JOURNEY_MATCHER_URL is not configured', async () => {
      // AC-4 safety: missing env var should not cause an unhandled crash
      delete process.env.JOURNEY_MATCHER_URL;
      const ctx = makeContext(fullExtractionStateData, 'YES');

      // Should not throw — must degrade gracefully
      const result = await ocrReviewHandler(ctx);

      expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
      // Falls back because it cannot call the route matcher
      expect([
        FSMState.AWAITING_JOURNEY_TIME,
        FSMState.AWAITING_JOURNEY_DATE,
        FSMState.ERROR,
      ]).toContain(result.nextState);
    });
  });

  // -------------------------------------------------------------------------
  // AC-5: Stations + date, no time → AWAITING_JOURNEY_TIME
  // Decision tree path: origin CRS + destination CRS + travelDate, no departureTime
  // -------------------------------------------------------------------------

  describe('AC-5: Stations + date extracted, departure time missing → ask for time', () => {
    it('should transition to AWAITING_JOURNEY_TIME when origin, destination, and date are present but no time', async () => {
      // AC-5: Skip date and station steps, only time is missing
      const ctx = makeContext(stationsAndDateStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should NOT call journey-matcher /routes when departure time is missing', async () => {
      // AC-5: Route match requires all 4 fields — without time, just route to AWAITING_JOURNEY_TIME
      const ctx = makeContext(stationsAndDateStateData, 'YES');

      await ocrReviewHandler(ctx);

      expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
    });

    it('should pre-fill origin, destination, and travelDate in stateData', async () => {
      // AC-5: Journey-time handler reads these from stateData — they must be pre-filled
      const ctx = makeContext(stationsAndDateStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.origin).toBe('PAD');
      expect(result.stateData?.destination).toBe('BRI');
      expect(result.stateData?.travelDate).toBe('2026-03-15');
    });

    it('should preserve origin and destination display names in stateData', async () => {
      // AC-5: Display names used in user-facing messages downstream
      const ctx = makeContext(stationsAndDateStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.originName).toBe('London Paddington');
      expect(result.stateData?.destinationName).toBe('Bristol Temple Meads');
    });

    it('should preserve OCR metadata (scan_id, image_gcs_path) in stateData', async () => {
      // AC-5: OCR traceability fields must survive the transition
      const ctx = makeContext(stationsAndDateStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.scan_id).toBe('scan-002');
      expect(result.stateData?.image_gcs_path).toBe(
        'gs://railrepay-tickets-prod/user-001/scan-002.jpg'
      );
    });

    it('should include journey context in the response message when routing to time step', async () => {
      // AC-5: User should know what was already captured so they only need to provide time
      const ctx = makeContext(stationsAndDateStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      // Message should communicate that stations and date are known, only time is needed
      expect(result.response).toMatch(/time|depart/i);
    });
  });

  // -------------------------------------------------------------------------
  // AC-6: Stations only, no date → AWAITING_JOURNEY_DATE
  // Decision tree path: origin CRS + destination CRS, no travelDate
  // Key distinction from S1: stations ARE pre-filled; message acknowledges this
  // -------------------------------------------------------------------------

  describe('AC-6: Stations extracted, date missing → ask for date (with station context)', () => {
    it('should transition to AWAITING_JOURNEY_DATE when origin and destination are present but no date', async () => {
      // AC-6: Stations extracted → skip stations step, go straight to date
      const ctx = makeContext(stationsOnlyStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should pre-fill origin and destination CRS codes in stateData', async () => {
      // AC-6: journey-date handler must see the pre-filled stations
      const ctx = makeContext(stationsOnlyStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.origin).toBe('MAN');
      expect(result.stateData?.destination).toBe('LDS');
    });

    it('should preserve station display names in stateData', async () => {
      // AC-6: Display names needed for downstream messaging
      const ctx = makeContext(stationsOnlyStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.originName).toBe('Manchester Piccadilly');
      expect(result.stateData?.destinationName).toBe('Leeds');
    });

    it('should preserve OCR metadata in stateData', async () => {
      // AC-6: scan_id / image_gcs_path must survive the transition
      const ctx = makeContext(stationsOnlyStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.scan_id).toBe('scan-003');
      expect(result.stateData?.image_gcs_path).toBe(
        'gs://railrepay-tickets-prod/user-001/scan-003.jpg'
      );
    });

    it('should communicate in the response that stations were already captured', async () => {
      // AC-6 key distinction: response should acknowledge pre-filled station context
      // so user knows they only need to provide the date
      const ctx = makeContext(stationsOnlyStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      // Should mention the stations and/or signal that only the date is needed
      expect(result.response).toMatch(/date|when|travel/i);
    });

    it('should NOT call journey-matcher /routes when date is missing', async () => {
      // AC-6: Cannot call routes without a date
      const ctx = makeContext(stationsOnlyStateData, 'YES');

      await ocrReviewHandler(ctx);

      expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // AC-7: Date only, no stations → AWAITING_JOURNEY_STATIONS
  // Decision tree path: no origin CRS, no destination CRS, has travelDate
  // -------------------------------------------------------------------------

  describe('AC-7: Date extracted, stations missing → ask for stations', () => {
    it('should transition to AWAITING_JOURNEY_STATIONS when only travelDate is extracted', async () => {
      // AC-7: Date known → skip date step, ask for "X to Y" stations
      const ctx = makeContext(dateOnlyStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_STATIONS);
    });

    it('should pre-fill travelDate in stateData so journey-stations handler carries it forward', async () => {
      // AC-7: journey-stations handler reads travelDate from stateData after user provides stations
      const ctx = makeContext(dateOnlyStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.travelDate).toBe('2026-04-01');
    });

    it('should preserve OCR metadata in stateData', async () => {
      // AC-7: scan_id / image_gcs_path preserved for traceability
      const ctx = makeContext(dateOnlyStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.scan_id).toBe('scan-004');
      expect(result.stateData?.image_gcs_path).toBe(
        'gs://railrepay-tickets-prod/user-001/scan-004.jpg'
      );
    });

    it('should NOT pre-fill origin or destination when they were not extracted', async () => {
      // AC-7: No origin/destination in stateData — do not invent values
      const ctx = makeContext(dateOnlyStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.origin).toBeUndefined();
      expect(result.stateData?.destination).toBeUndefined();
    });

    it('should NOT call journey-matcher /routes when stations are missing', async () => {
      // AC-7: Cannot match routes without stations
      const ctx = makeContext(dateOnlyStateData, 'YES');

      await ocrReviewHandler(ctx);

      expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // AC-8: Station names without CRS codes → attempt CRS lookup via searchStations()
  // Decision tree path: no origin/destination CRS, but has originName/destinationName
  // -------------------------------------------------------------------------

  describe('AC-8: Station names without CRS codes — CRS lookup fallback', () => {
    describe('AC-8 success: both station names resolve to CRS codes', () => {
      it('should call searchStations() for both station names when CRS codes are absent', async () => {
        // AC-8: Attempt CRS resolution for both names
        vi.mocked(searchStations)
          .mockResolvedValueOnce([{ crs: 'PAD', name: 'London Paddington' }])
          .mockResolvedValueOnce([{ crs: 'BRI', name: 'Bristol Temple Meads' }]);
        const ctx = makeContext(stationNamesNoCrsStateData, 'YES');

        await ocrReviewHandler(ctx);

        expect(vi.mocked(searchStations)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(searchStations)).toHaveBeenCalledWith('London Paddington');
        expect(vi.mocked(searchStations)).toHaveBeenCalledWith('Bristol Temple Meads');
      });

      it('should treat resolved CRS codes as fully present and route to AC-5 when travelDate is available', async () => {
        // AC-8 + AC-5 path: both resolved + date → AWAITING_JOURNEY_TIME (as in AC-5)
        vi.mocked(searchStations)
          .mockResolvedValueOnce([{ crs: 'PAD', name: 'London Paddington' }])
          .mockResolvedValueOnce([{ crs: 'BRI', name: 'Bristol Temple Meads' }]);
        // stationNamesNoCrsStateData has travelDate but no departureTime → should go to AWAITING_JOURNEY_TIME
        const ctx = makeContext(stationNamesNoCrsStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
      });

      it('should store resolved CRS codes in stateData after successful lookup', async () => {
        // AC-8: Resolved CRS codes must be written to stateData
        vi.mocked(searchStations)
          .mockResolvedValueOnce([{ crs: 'PAD', name: 'London Paddington' }])
          .mockResolvedValueOnce([{ crs: 'BRI', name: 'Bristol Temple Meads' }]);
        const ctx = makeContext(stationNamesNoCrsStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        expect(result.stateData?.origin).toBe('PAD');
        expect(result.stateData?.destination).toBe('BRI');
      });

      it('should route to AWAITING_JOURNEY_DATE (AC-6 path) when both resolve but no date available', async () => {
        // AC-8 + AC-6 path: both stations resolved, no travelDate → AWAITING_JOURNEY_DATE
        const noCrsNoDateStateData = {
          originName: 'Manchester Piccadilly',
          destinationName: 'Leeds',
          scan_id: 'scan-008a',
          ocr_confidence: 0.60,
          image_gcs_path: 'gs://railrepay-tickets-prod/user-001/scan-008a.jpg',
          // No travelDate — resolved stations but date is missing
        };
        vi.mocked(searchStations)
          .mockResolvedValueOnce([{ crs: 'MAN', name: 'Manchester Piccadilly' }])
          .mockResolvedValueOnce([{ crs: 'LDS', name: 'Leeds' }]);
        const ctx = makeContext(noCrsNoDateStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
      });

      it('should attempt auto route match (AC-4 path) when both resolve and all 4 fields are available', async () => {
        // AC-8 + AC-4 path: both resolved + date + time → call /routes
        const noCrsFullDateTimeStateData = {
          originName: 'London Paddington',
          destinationName: 'Bristol Temple Meads',
          travelDate: '2026-03-15',
          departureTime: '14:30',
          scan_id: 'scan-008b',
          ocr_confidence: 0.60,
          image_gcs_path: 'gs://railrepay-tickets-prod/user-001/scan-008b.jpg',
        };
        vi.mocked(searchStations)
          .mockResolvedValueOnce([{ crs: 'PAD', name: 'London Paddington' }])
          .mockResolvedValueOnce([{ crs: 'BRI', name: 'Bristol Temple Meads' }]);
        mockDirectRouteResponse();
        const ctx = makeContext(noCrsFullDateTimeStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        expect(vi.mocked(axios.get)).toHaveBeenCalledOnce();
        expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
      });
    });

    describe('AC-8 partial: one station resolves, the other does not', () => {
      it('should handle the case where origin resolves but destination does not', async () => {
        // AC-8 partial: one station resolved → pre-fill what resolved, route to next missing step
        vi.mocked(searchStations)
          .mockResolvedValueOnce([{ crs: 'PAD', name: 'London Paddington' }]) // origin resolves
          .mockResolvedValueOnce([]); // destination fails
        const ctx = makeContext(stationNamesNoCrsStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        // Has origin CRS resolved, but no destination CRS → cannot proceed to time step
        // Should route to a state where destination can be provided
        expect([
          FSMState.AWAITING_JOURNEY_STATIONS,
          FSMState.AWAITING_JOURNEY_DATE,
        ]).toContain(result.nextState);
      });

      it('should pre-fill the resolved origin CRS in stateData even when destination fails', async () => {
        // AC-8 partial: resolved station must be in stateData
        vi.mocked(searchStations)
          .mockResolvedValueOnce([{ crs: 'PAD', name: 'London Paddington' }])
          .mockResolvedValueOnce([]);
        const ctx = makeContext(stationNamesNoCrsStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        expect(result.stateData?.origin).toBe('PAD');
      });

      it('should handle the case where destination resolves but origin does not', async () => {
        // AC-8 partial: destination resolves, origin fails
        const reverseFailStateData = {
          originName: 'Unknown Station',
          destinationName: 'Bristol Temple Meads',
          travelDate: '2026-03-15',
          scan_id: 'scan-008c',
          ocr_confidence: 0.50,
          image_gcs_path: 'gs://railrepay-tickets-prod/user-001/scan-008c.jpg',
        };
        vi.mocked(searchStations)
          .mockResolvedValueOnce([]) // origin fails
          .mockResolvedValueOnce([{ crs: 'BRI', name: 'Bristol Temple Meads' }]); // destination resolves
        const ctx = makeContext(reverseFailStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        // Cannot proceed without origin — must route to station collection step
        expect([
          FSMState.AWAITING_JOURNEY_STATIONS,
          FSMState.AWAITING_JOURNEY_DATE,
        ]).toContain(result.nextState);
      });
    });

    describe('AC-8 failure: neither station name resolves', () => {
      it('should fall back to AWAITING_JOURNEY_STATIONS when lookup fails and travelDate is available', async () => {
        // AC-8 failure + date present → AC-7 variant: date pre-filled, ask for stations
        vi.mocked(searchStations)
          .mockResolvedValueOnce([]) // origin lookup fails
          .mockResolvedValueOnce([]); // destination lookup fails
        // stationNamesNoCrsStateData has travelDate → AWAITING_JOURNEY_STATIONS with date pre-filled
        const ctx = makeContext(stationNamesNoCrsStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_STATIONS);
      });

      it('should pre-fill travelDate in stateData when lookup fails but date was extracted', async () => {
        // AC-8 failure: travelDate survives even when CRS lookup fails
        vi.mocked(searchStations)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);
        const ctx = makeContext(stationNamesNoCrsStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        expect(result.stateData?.travelDate).toBe('2026-03-15');
      });

      it('should fall back to AWAITING_JOURNEY_DATE when lookup fails and no travelDate', async () => {
        // AC-8 failure + no date → AC-9 variant: full fallback to AWAITING_JOURNEY_DATE
        const noCrsNoDayStateData = {
          originName: 'Unknown A',
          destinationName: 'Unknown B',
          scan_id: 'scan-008d',
          ocr_confidence: 0.30,
          image_gcs_path: 'gs://railrepay-tickets-prod/user-001/scan-008d.jpg',
        };
        vi.mocked(searchStations)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);
        const ctx = makeContext(noCrsNoDayStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
      });

      it('should preserve OCR metadata in stateData even when CRS lookup entirely fails', async () => {
        // AC-8 failure: scan_id and image_gcs_path must always be preserved
        vi.mocked(searchStations)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);
        const ctx = makeContext(stationNamesNoCrsStateData, 'YES');

        const result = await ocrReviewHandler(ctx);

        expect(result.stateData?.scan_id).toBe('scan-005');
        expect(result.stateData?.image_gcs_path).toBe(
          'gs://railrepay-tickets-prod/user-001/scan-005.jpg'
        );
      });

      it('should NOT crash when searchStations() throws an error', async () => {
        // AC-8 error handling: station lookup errors must not crash the handler
        vi.mocked(searchStations)
          .mockRejectedValueOnce(new Error('DB connection failed'))
          .mockRejectedValueOnce(new Error('DB connection failed'));
        const ctx = makeContext(stationNamesNoCrsStateData, 'YES');

        // Should not throw
        const result = await ocrReviewHandler(ctx);

        // Falls back as if lookup failed
        expect([
          FSMState.AWAITING_JOURNEY_STATIONS,
          FSMState.AWAITING_JOURNEY_DATE,
        ]).toContain(result.nextState);
      });
    });
  });

  // -------------------------------------------------------------------------
  // AC-9: No usable fields → AWAITING_JOURNEY_DATE with friendly fallback message
  // Decision tree path: no origin, no destination, no station names, no travelDate
  // -------------------------------------------------------------------------

  describe('AC-9: No usable fields extracted — friendly fallback to manual entry', () => {
    it('should transition to AWAITING_JOURNEY_DATE when no usable fields were extracted', async () => {
      // AC-9: Full fallback — nothing extracted → start manual entry from the beginning
      const ctx = makeContext(noUsableFieldsStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should send a friendly message explaining the ticket could not be read', async () => {
      // AC-9: "I couldn't read your ticket clearly. Let's enter your journey details manually."
      const ctx = makeContext(noUsableFieldsStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toMatch(/couldn.*read|unclear|manually|enter.*detail/i);
    });

    it('should NOT call journey-matcher /routes when no usable fields are present', async () => {
      // AC-9: No route matching possible without any data
      const ctx = makeContext(noUsableFieldsStateData, 'YES');

      await ocrReviewHandler(ctx);

      expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
    });

    it('should NOT call searchStations() when no station names are present', async () => {
      // AC-9: No station names to look up
      const ctx = makeContext(noUsableFieldsStateData, 'YES');

      await ocrReviewHandler(ctx);

      expect(vi.mocked(searchStations)).not.toHaveBeenCalled();
    });

    it('should preserve OCR metadata (scan_id, image_gcs_path) even when no journey fields are usable', async () => {
      // AC-9: scan_id and image_gcs_path preserved for audit/traceability per spec FR-6
      const ctx = makeContext(noUsableFieldsStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.scan_id).toBe('scan-006');
      expect(result.stateData?.image_gcs_path).toBe(
        'gs://railrepay-tickets-prod/user-001/scan-006.jpg'
      );
    });

    it('should NOT pre-fill any journey fields (origin, destination, travelDate) in stateData', async () => {
      // AC-9: No journey data was extracted — stateData must not have fabricated values
      const ctx = makeContext(noUsableFieldsStateData, 'YES');

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.origin).toBeUndefined();
      expect(result.stateData?.destination).toBeUndefined();
      expect(result.stateData?.travelDate).toBeUndefined();
      expect(result.stateData?.departureTime).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Observability: routing decisions must be logged
  // -------------------------------------------------------------------------

  describe('Observability: INFO-level routing decision logging (ADR-002, ADR-008)', () => {
    it('should log the routing decision (AC-4 path) at INFO level with correlationId', async () => {
      // ADR-002: Structured logging with correlation ID
      mockDirectRouteResponse();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      await ocrReviewHandler(ctx);

      expect(sharedLogger.info).toHaveBeenCalled();
      const logCalls = sharedLogger.info.mock.calls;
      const hasCorrelationId = logCalls.some(
        (call: any[]) => call[1]?.correlationId === 'corr-review-001'
      );
      expect(hasCorrelationId).toBe(true);
    });

    it('should log the routing decision (AC-5 path) at INFO level', async () => {
      // ADR-002: Routing path logged for each scenario
      const ctx = makeContext(stationsAndDateStateData, 'YES');

      await ocrReviewHandler(ctx);

      expect(sharedLogger.info).toHaveBeenCalled();
    });

    it('should log at ERROR level when route-matcher call fails', async () => {
      // ADR-002: Errors must be logged
      mockAxiosTimeout();
      const ctx = makeContext(fullExtractionStateData, 'YES');

      await ocrReviewHandler(ctx);

      expect(sharedLogger.error).toHaveBeenCalled();
    });
  });
});
