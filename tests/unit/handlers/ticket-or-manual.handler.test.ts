/**
 * Ticket-or-Manual Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * BL-167: TD-WHATSAPP-062-S1 — Core FSM + OCR Call + User Confirmation
 * SPEC: services/whatsapp-handler/docs/phases/TD-WHATSAPP-062-S1-SPECIFICATION.md
 * Per ADR-014: These tests define the behavior. Implementation does not exist yet.
 * Per Test Lock Rule: Blake MUST NOT modify these tests.
 *
 * State handled: AWAITING_TICKET_OR_MANUAL
 * Triggered from: AUTHENTICATED + "DELAY" or "CLAIM" (AC-1)
 *
 * Test coverage:
 * - AC-1: AWAITING_TICKET_OR_MANUAL state handler exists and sends correct prompt
 * - AC-2: MANUAL keyword transitions to AWAITING_JOURNEY_DATE
 * - AC-3: Media attachment triggers OCR service call (POST /ocr/scan)
 * - AC-22: OCR service error (503/timeout/network) falls back to AWAITING_JOURNEY_DATE
 *
 * FSM TRIGGER:  AUTHENTICATED + "DELAY"/"CLAIM" → AWAITING_TICKET_OR_MANUAL
 * FSM OUTPUTS:
 *   - "MANUAL"  → AWAITING_JOURNEY_DATE (clean stateData)
 *   - media     → OCR success → AWAITING_OCR_REVIEW
 *   - media     → OCR failure → AWAITING_JOURNEY_DATE (fallback)
 *   - text (not MANUAL, no media) → stay in AWAITING_TICKET_OR_MANUAL
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ticketOrManualHandler } from '../../../src/handlers/ticket-or-manual.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// Infrastructure package mocking per Section 6.1.11:
// Shared logger instance OUTSIDE the factory to ensure all tests assert against same mock.
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// Mock the OCR client service so no real HTTP calls are made in unit tests.
// Verified: src/services/ocr-client.service.ts will expose callOcrService().
vi.mock('../../../src/services/ocr-client.service', () => ({
  callOcrService: vi.fn(),
}));

import { callOcrService } from '../../../src/services/ocr-client.service';

describe('TD-WHATSAPP-062-S1: Ticket-or-Manual Handler (AWAITING_TICKET_OR_MANUAL)', () => {
  let mockContext: HandlerContext;
  let mockUser: User;

  beforeEach(() => {
    mockUser = {
      id: 'user-ocr-001',
      phone_number: '+447700900200',
      verified_at: new Date('2026-01-10T09:00:00Z'),
      created_at: new Date('2026-01-10T09:00:00Z'),
      updated_at: new Date('2026-01-10T09:00:00Z'),
    };

    mockContext = {
      phoneNumber: '+447700900200',
      messageBody: '',
      messageSid: 'SMticket001',
      user: mockUser,
      currentState: FSMState.AWAITING_TICKET_OR_MANUAL,
      correlationId: 'corr-ticket-001',
      stateData: {},
    };

    // Reset env var for OCR service URL
    process.env.OCR_SERVICE_URL = 'http://railrepay-ocr.test:3010';

    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.OCR_SERVICE_URL;
  });

  // -------------------------------------------------------------------------
  // AC-1: Handler exists and sends the correct branching prompt
  // -------------------------------------------------------------------------

  describe('AC-1: AWAITING_TICKET_OR_MANUAL state prompt', () => {
    it('should send the ticket-or-manual prompt when invoked (no input provided yet)', async () => {
      // AC-1: New FSM state sends: "Send a photo of your ticket to get started quickly,
      // or type MANUAL to enter your journey details."
      // This covers the entry scenario when the state is first reached.
      mockContext.messageBody = '';
      mockContext.mediaUrl = undefined;

      const result = await ticketOrManualHandler(mockContext);

      expect(result.response).toContain('photo');
      expect(result.response).toContain('MANUAL');
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_OR_MANUAL);
    });

    it('should stay in AWAITING_TICKET_OR_MANUAL when user sends unrecognised text without media', async () => {
      // AC-1: Only MANUAL and media trigger transitions. Any other text stays in state.
      mockContext.messageBody = 'hello there';
      mockContext.mediaUrl = undefined;

      const result = await ticketOrManualHandler(mockContext);

      expect(result.response).toContain('photo');
      expect(result.response).toContain('MANUAL');
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_OR_MANUAL);
    });
  });

  // -------------------------------------------------------------------------
  // AC-2: MANUAL keyword transitions to AWAITING_JOURNEY_DATE
  // -------------------------------------------------------------------------

  describe('AC-2: MANUAL keyword bypass to manual flow', () => {
    it('should transition to AWAITING_JOURNEY_DATE when user sends "MANUAL"', async () => {
      // AC-2: "MANUAL" at AWAITING_TICKET_OR_MANUAL → AWAITING_JOURNEY_DATE (existing manual flow)
      mockContext.messageBody = 'MANUAL';
      mockContext.mediaUrl = undefined;

      const result = await ticketOrManualHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should accept "manual" (lowercase) and transition to AWAITING_JOURNEY_DATE', async () => {
      // AC-2: Case-insensitive keyword matching
      mockContext.messageBody = 'manual';
      mockContext.mediaUrl = undefined;

      const result = await ticketOrManualHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should send a date-prompt message when user chooses MANUAL', async () => {
      // AC-2: Manual flow prompt should ask for the journey date (same as existing AWAITING_JOURNEY_DATE entry)
      mockContext.messageBody = 'MANUAL';
      mockContext.mediaUrl = undefined;

      const result = await ticketOrManualHandler(mockContext);

      expect(result.response).toMatch(/when|date|travel/i);
    });

    it('should NOT call the OCR service when user sends MANUAL', async () => {
      // AC-2: Manual bypass must not trigger an OCR HTTP request
      mockContext.messageBody = 'MANUAL';
      mockContext.mediaUrl = undefined;

      await ticketOrManualHandler(mockContext);

      expect(callOcrService).not.toHaveBeenCalled();
    });

    it('should produce clean stateData (no OCR fields) when transitioning via MANUAL', async () => {
      // AC-2: Manual flow starts with clean state — no OCR scan_id, no extracted_fields
      mockContext.messageBody = 'MANUAL';
      mockContext.mediaUrl = undefined;

      const result = await ticketOrManualHandler(mockContext);

      expect(result.stateData?.scan_id).toBeUndefined();
      expect(result.stateData?.ocr_confidence).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // AC-3: Media attachment triggers synchronous OCR POST /ocr/scan call
  // -------------------------------------------------------------------------

  describe('AC-3: Media triggers synchronous OCR call', () => {
    it('should call the OCR service with correct payload when media is attached', async () => {
      // AC-3: POST /ocr/scan with image_url, user_id, content_type, correlation_id
      // Verified: OCR service exposes POST /ocr/scan (railrepay-ocr service)
      mockContext.mediaUrl = 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME789';
      mockContext.messageBody = '';
      mockContext.mediaContentType = 'image/jpeg';

      vi.mocked(callOcrService).mockResolvedValueOnce({
        scan_id: 'scan-uuid-001',
        status: 'completed',
        confidence: 0.92,
        extracted_fields: {
          origin_station: 'London Paddington',
          destination_station: 'Bristol Temple Meads',
          origin_crs: 'PAD',
          destination_crs: 'BRI',
          travel_date: '2026-03-15',
          departure_time: '14:30',
          ticket_type: 'advance single',
          ticket_class: 'standard',
          fare_pence: 3500,
          via_station: null,
          via_crs: null,
          operator_name: 'GWR',
        },
        missing_fields: [],
        claim_ready: true,
        ocr_status: 'completed',
        gcs_upload_status: 'uploaded',
        image_gcs_path: 'gs://railrepay-tickets-prod/user-ocr-001/scan-uuid-001.jpg',
      });

      await ticketOrManualHandler(mockContext);

      expect(callOcrService).toHaveBeenCalledWith(
        expect.objectContaining({
          image_url: 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME789',
          user_id: 'user-ocr-001',
          content_type: 'image/jpeg',
          correlation_id: 'corr-ticket-001',
        }),
        expect.any(String) // OCR_SERVICE_URL base URL
      );
    });

    it('should transition to AWAITING_OCR_REVIEW after successful OCR extraction', async () => {
      // AC-3 + AC-10: Successful OCR → AWAITING_OCR_REVIEW with extracted data presented
      mockContext.mediaUrl = 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME790';
      mockContext.messageBody = '';
      mockContext.mediaContentType = 'image/jpeg';

      vi.mocked(callOcrService).mockResolvedValueOnce({
        scan_id: 'scan-uuid-002',
        status: 'completed',
        confidence: 0.88,
        extracted_fields: {
          origin_station: 'Manchester Piccadilly',
          destination_station: 'Leeds',
          origin_crs: 'MAN',
          destination_crs: 'LDS',
          travel_date: '2026-04-01',
          departure_time: '09:15',
          ticket_type: 'off-peak return',
          ticket_class: 'standard',
          fare_pence: 2200,
          via_station: null,
          via_crs: null,
          operator_name: 'TPE',
        },
        missing_fields: [],
        claim_ready: true,
        ocr_status: 'completed',
        gcs_upload_status: 'uploaded',
        image_gcs_path: 'gs://railrepay-tickets-prod/user-ocr-001/scan-uuid-002.jpg',
      });

      const result = await ticketOrManualHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_OCR_REVIEW);
    });

    it('should store OCR scan_id, confidence, and extracted fields in stateData after successful scan', async () => {
      // AC-3: stateData should include scan_id, image_gcs_path, ocr_confidence, claim_ready
      // and all non-null extracted fields under their standard field names
      mockContext.mediaUrl = 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME791';
      mockContext.messageBody = '';
      mockContext.mediaContentType = 'image/png';

      vi.mocked(callOcrService).mockResolvedValueOnce({
        scan_id: 'scan-uuid-003',
        status: 'completed',
        confidence: 0.79,
        extracted_fields: {
          origin_station: 'Birmingham New Street',
          destination_station: 'London Euston',
          origin_crs: 'BHM',
          destination_crs: 'EUS',
          travel_date: '2026-03-20',
          departure_time: '11:00',
          ticket_type: 'anytime single',
          ticket_class: 'first',
          fare_pence: 18900,
          via_station: null,
          via_crs: null,
          operator_name: 'LNWR',
        },
        missing_fields: [],
        claim_ready: true,
        ocr_status: 'completed',
        gcs_upload_status: 'uploaded',
        image_gcs_path: 'gs://railrepay-tickets-prod/user-ocr-001/scan-uuid-003.jpg',
      });

      const result = await ticketOrManualHandler(mockContext);

      expect(result.stateData).toBeDefined();
      expect(result.stateData?.scan_id).toBe('scan-uuid-003');
      expect(result.stateData?.ocr_confidence).toBe(0.79);
      expect(result.stateData?.claim_ready).toBe(true);
      expect(result.stateData?.image_gcs_path).toBe(
        'gs://railrepay-tickets-prod/user-ocr-001/scan-uuid-003.jpg'
      );
      // Extracted fields stored under standard names
      expect(result.stateData?.origin).toBe('BHM');
      expect(result.stateData?.destination).toBe('EUS');
      expect(result.stateData?.travelDate).toBe('2026-03-20');
      expect(result.stateData?.departureTime).toBe('11:00');
    });

    it('should send unsupported-type error and stay in state when media has unsupported content type', async () => {
      // AC-3: Only image/jpeg, image/png, application/pdf are accepted.
      // Unsupported type (e.g. video/mp4) sends error and stays in AWAITING_TICKET_OR_MANUAL.
      mockContext.mediaUrl = 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME792';
      mockContext.messageBody = '';
      mockContext.mediaContentType = 'video/mp4';

      const result = await ticketOrManualHandler(mockContext);

      expect(callOcrService).not.toHaveBeenCalled();
      expect(result.response).toMatch(/sorry|unsupported|photo|image|pdf/i);
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_OR_MANUAL);
    });
  });

  // -------------------------------------------------------------------------
  // AC-22: OCR service errors fall back gracefully to manual flow
  // -------------------------------------------------------------------------

  describe('AC-22: OCR service error handling — graceful fallback', () => {
    it('should fall back to AWAITING_JOURNEY_DATE when OCR service returns 503', async () => {
      // AC-22: 503 from OCR → friendly message + transition to AWAITING_JOURNEY_DATE
      mockContext.mediaUrl = 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME793';
      mockContext.messageBody = '';
      mockContext.mediaContentType = 'image/jpeg';

      const serviceUnavailableError = Object.assign(new Error('Request failed with status code 503'), {
        response: { status: 503, data: { error: 'GCV OCR unavailable' } },
        isAxiosError: true,
      });
      vi.mocked(callOcrService).mockRejectedValueOnce(serviceUnavailableError);

      const result = await ticketOrManualHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
      expect(result.response).toMatch(/couldn't process|try again|manually|details/i);
    });

    it('should fall back to AWAITING_JOURNEY_DATE when OCR service times out', async () => {
      // AC-22: Timeout (>10s) → graceful fallback
      mockContext.mediaUrl = 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME794';
      mockContext.messageBody = '';
      mockContext.mediaContentType = 'application/pdf';

      const timeoutError = Object.assign(new Error('timeout of 10000ms exceeded'), {
        code: 'ECONNABORTED',
        isAxiosError: true,
      });
      vi.mocked(callOcrService).mockRejectedValueOnce(timeoutError);

      const result = await ticketOrManualHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
      expect(result.response).toMatch(/couldn't process|manually|details/i);
    });

    it('should fall back to AWAITING_JOURNEY_DATE when OCR service is unreachable (ECONNREFUSED)', async () => {
      // AC-22: Network error / ECONNREFUSED → graceful fallback
      mockContext.mediaUrl = 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME795';
      mockContext.messageBody = '';
      mockContext.mediaContentType = 'image/png';

      const networkError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3010'), {
        code: 'ECONNREFUSED',
        isAxiosError: true,
      });
      vi.mocked(callOcrService).mockRejectedValueOnce(networkError);

      const result = await ticketOrManualHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should log a warning with correlation_id when OCR call fails', async () => {
      // AC-22: Observability — log warning on failure (ADR-002)
      mockContext.mediaUrl = 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME796';
      mockContext.messageBody = '';
      mockContext.mediaContentType = 'image/jpeg';

      const ocrError = Object.assign(new Error('Service unavailable'), {
        response: { status: 503 },
        isAxiosError: true,
      });
      vi.mocked(callOcrService).mockRejectedValueOnce(ocrError);

      await ticketOrManualHandler(mockContext);

      expect(sharedLogger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          correlationId: 'corr-ticket-001',
        })
      );
    });

    it('should produce clean stateData (no OCR fields) when falling back after OCR failure', async () => {
      // AC-22: Fallback state must not carry partial OCR data
      mockContext.mediaUrl = 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME797';
      mockContext.messageBody = '';
      mockContext.mediaContentType = 'image/jpeg';

      vi.mocked(callOcrService).mockRejectedValueOnce(new Error('OCR service down'));

      const result = await ticketOrManualHandler(mockContext);

      expect(result.stateData?.scan_id).toBeUndefined();
      expect(result.stateData?.ocr_confidence).toBeUndefined();
      expect(result.stateData?.extracted_fields).toBeUndefined();
    });
  });
});
