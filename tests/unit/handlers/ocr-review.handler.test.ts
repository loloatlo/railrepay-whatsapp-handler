/**
 * OCR Review Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * BL-167: TD-WHATSAPP-062-S1 — Core FSM + OCR Call + User Confirmation
 * SPEC: services/whatsapp-handler/docs/phases/TD-WHATSAPP-062-S1-SPECIFICATION.md
 * Per ADR-014: These tests define the behavior. Implementation does not exist yet.
 * Per Test Lock Rule: Blake MUST NOT modify these tests.
 *
 * State handled: AWAITING_OCR_REVIEW
 * Triggered from: AWAITING_TICKET_OR_MANUAL + successful OCR scan
 *
 * Test coverage:
 * - AC-10: Presents readable summary of extracted OCR fields
 * - AC-11: YES confirms OCR data → transitions to AWAITING_JOURNEY_DATE with pre-filled stateData
 * - AC-12: NO discards OCR data → transitions to AWAITING_JOURNEY_DATE with clean stateData
 *
 * FSM TRIGGER:  AWAITING_TICKET_OR_MANUAL + media + OCR success → AWAITING_OCR_REVIEW
 * FSM OUTPUTS:
 *   - "YES" → AWAITING_JOURNEY_DATE (stateData pre-filled with OCR fields)
 *   - "NO"  → AWAITING_JOURNEY_DATE (clean stateData)
 *   - other → stay in AWAITING_OCR_REVIEW
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ocrReviewHandler } from '../../../src/handlers/ocr-review.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// Infrastructure package mocking per Section 6.1.11
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

describe('TD-WHATSAPP-062-S1: OCR Review Handler (AWAITING_OCR_REVIEW)', () => {
  let mockUser: User;

  // Representative stateData stored after a successful OCR scan (from ticket-or-manual handler)
  const fullOcrStateData = {
    scan_id: 'scan-review-001',
    ocr_confidence: 0.91,
    claim_ready: true,
    image_gcs_path: 'gs://railrepay-tickets-prod/user-review-001/scan-review-001.jpg',
    // Standard field names (as mapped by ticket-or-manual handler)
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

  beforeEach(() => {
    mockUser = {
      id: 'user-review-001',
      phone_number: '+447700900300',
      verified_at: new Date('2026-01-15T08:00:00Z'),
      created_at: new Date('2026-01-15T08:00:00Z'),
      updated_at: new Date('2026-01-15T08:00:00Z'),
    };

    vi.clearAllMocks();
  });

  function makeContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
    return {
      phoneNumber: '+447700900300',
      messageBody: '',
      messageSid: 'SMreview001',
      user: mockUser,
      currentState: FSMState.AWAITING_OCR_REVIEW,
      correlationId: 'corr-review-001',
      stateData: { ...fullOcrStateData },
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // AC-10: Readable summary of extracted fields is presented to the user
  // -------------------------------------------------------------------------

  describe('AC-10: OCR extraction summary display', () => {
    it('should present a readable summary containing origin and destination when both are extracted', async () => {
      // AC-10: Summary must show extracted journey details before asking YES/NO
      const ctx = makeContext({ messageBody: '' });

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toContain('London Paddington');
      expect(result.response).toContain('Bristol Temple Meads');
      expect(result.nextState).toBe(FSMState.AWAITING_OCR_REVIEW);
    });

    it('should include the travel date in the summary when it was extracted', async () => {
      // AC-10: Show date field in readable format
      const ctx = makeContext({ messageBody: '' });

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toContain('2026-03-15');
    });

    it('should include the departure time in the summary when it was extracted', async () => {
      // AC-10: Show time field
      const ctx = makeContext({ messageBody: '' });

      const result = await ocrReviewHandler(ctx);

      expect(result.response).toContain('14:30');
    });

    it('should ask the user to confirm with YES or NO', async () => {
      // AC-10: Summary must end with a YES/NO confirmation prompt
      const ctx = makeContext({ messageBody: '' });

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
        // Only date and origin extracted; destination missing
        origin: 'MAN',
        originName: 'Manchester Piccadilly',
        travelDate: '2026-04-10',
      };

      const ctx = makeContext({
        messageBody: '',
        stateData: partialStateData,
      });

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
        // via fields are null in this scan
        viaStation: null,
        viaCrs: null,
      };

      const ctx = makeContext({
        messageBody: '',
        stateData: stateDataWithNulls,
      });

      const result = await ocrReviewHandler(ctx);

      // null / undefined values must not appear as "null" or "undefined" text in the response
      expect(result.response).not.toContain('null');
      expect(result.response).not.toContain('undefined');
    });
  });

  // -------------------------------------------------------------------------
  // AC-11: YES confirms OCR data — transitions to AWAITING_JOURNEY_DATE with pre-filled stateData
  // -------------------------------------------------------------------------

  describe('AC-11: YES confirmation — keep OCR data, proceed to journey date', () => {
    it('should transition to AWAITING_JOURNEY_DATE when user sends "YES"', async () => {
      // AC-11: YES → AWAITING_JOURNEY_DATE (Sub-Story 1 always goes here; adaptive routing is S2)
      const ctx = makeContext({ messageBody: 'YES' });

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should accept "yes" (lowercase) and transition to AWAITING_JOURNEY_DATE', async () => {
      // AC-11: Case-insensitive YES
      const ctx = makeContext({ messageBody: 'yes' });

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should preserve all OCR-extracted fields in stateData when user confirms YES', async () => {
      // AC-11: Pre-filled stateData includes origin, destination, travelDate, departureTime
      // and the other fields that the journey-date handler will read
      const ctx = makeContext({ messageBody: 'YES' });

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData).toBeDefined();
      expect(result.stateData?.origin).toBe('PAD');
      expect(result.stateData?.destination).toBe('BRI');
      expect(result.stateData?.originName).toBe('London Paddington');
      expect(result.stateData?.destinationName).toBe('Bristol Temple Meads');
      expect(result.stateData?.travelDate).toBe('2026-03-15');
      expect(result.stateData?.departureTime).toBe('14:30');
    });

    it('should retain scan_id and ocr_confidence in stateData after YES confirmation', async () => {
      // AC-11: scan_id and confidence are carried forward (for audit/downstream use)
      const ctx = makeContext({ messageBody: 'YES' });

      const result = await ocrReviewHandler(ctx);

      expect(result.stateData?.scan_id).toBe('scan-review-001');
      expect(result.stateData?.ocr_confidence).toBe(0.91);
    });

    it('should preserve only available OCR fields when partial data was extracted', async () => {
      // AC-11: Partial extraction — only available fields pre-fill stateData
      const partialOcrStateData = {
        scan_id: 'scan-partial-yes-001',
        ocr_confidence: 0.55,
        claim_ready: false,
        image_gcs_path: 'gs://railrepay-tickets-prod/user-review-001/scan-partial-yes-001.jpg',
        origin: 'LDS',
        originName: 'Leeds',
        travelDate: '2026-05-01',
        // destination NOT extracted
      };

      const ctx = makeContext({
        messageBody: 'YES',
        stateData: partialOcrStateData,
      });

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
      expect(result.stateData?.origin).toBe('LDS');
      expect(result.stateData?.travelDate).toBe('2026-05-01');
      // destination was not extracted, so it must not be set to a wrong value
      expect(result.stateData?.destination).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // AC-12: NO discards OCR data — transitions to AWAITING_JOURNEY_DATE with clean stateData
  // -------------------------------------------------------------------------

  describe('AC-12: NO rejection — discard OCR data, start manual flow', () => {
    it('should transition to AWAITING_JOURNEY_DATE when user sends "NO"', async () => {
      // AC-12: NO → discard OCR data, go to AWAITING_JOURNEY_DATE (same as MANUAL path)
      const ctx = makeContext({ messageBody: 'NO' });

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should accept "no" (lowercase) and transition to AWAITING_JOURNEY_DATE', async () => {
      // AC-12: Case-insensitive NO
      const ctx = makeContext({ messageBody: 'no' });

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should discard all OCR-extracted fields from stateData when user rejects with NO', async () => {
      // AC-12: NO path must produce clean stateData — no scan_id, no origin, no travelDate
      const ctx = makeContext({ messageBody: 'NO' });

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
      const ctx = makeContext({ messageBody: 'NO' });

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
      const ctx = makeContext({ messageBody: 'maybe' });

      const result = await ocrReviewHandler(ctx);

      expect(result.nextState).toBe(FSMState.AWAITING_OCR_REVIEW);
      expect(result.response).toContain('YES');
      expect(result.response).toContain('NO');
    });
  });
});
