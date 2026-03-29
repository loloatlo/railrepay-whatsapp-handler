/**
 * OCR Client Service Tests - Written FIRST per ADR-014 (TDD)
 *
 * BL-167: TD-WHATSAPP-062-S1 — Core FSM + OCR Call + User Confirmation
 * SPEC: services/whatsapp-handler/docs/phases/TD-WHATSAPP-062-S1-SPECIFICATION.md
 * Per ADR-014: These tests define the behavior. Implementation does not exist yet.
 * Per Test Lock Rule: Blake MUST NOT modify these tests.
 *
 * Module under test: src/services/ocr-client.service.ts
 * Public API: callOcrService(payload, baseUrl) → OcrScanResponse
 *
 * Mocked endpoint: POST http://{baseUrl}/ocr/scan
 * Verified: railrepay-ocr service exposes POST /ocr/scan (confirmed from OCR service spec)
 *
 * Test coverage:
 * - Successful 200 response — returns parsed OcrScanResponse
 * - 503 response — throws an error (caller handles graceful fallback)
 * - Timeout (>10s) — throws a timeout error
 * - Network unreachable (ECONNREFUSED) — throws a network error
 * - Correct request shape — image_url, user_id, content_type, correlation_id
 * - AC-25: Uses OCR_SERVICE_URL env var with correct default
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios from 'axios';
import { callOcrService } from '../../../src/services/ocr-client.service';

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

// Mock axios at the module level so no real HTTP calls are made.
vi.mock('axios');

const mockAxiosPost = vi.mocked(axios.post);

describe('TD-WHATSAPP-062-S1: OCR Client Service', () => {
  const testBaseUrl = 'http://railrepay-ocr.test:3010';

  const validPayload = {
    image_url: 'https://api.twilio.com/Accounts/AC123/Messages/SM456/Media/ME001',
    user_id: 'user-ocr-svc-001',
    content_type: 'image/jpeg' as const,
    correlation_id: 'corr-svc-001',
  };

  const successfulOcrResponse = {
    scan_id: 'svc-scan-uuid-001',
    status: 'completed',
    confidence: 0.87,
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
    image_gcs_path: 'gs://railrepay-tickets-prod/user-ocr-svc-001/svc-scan-uuid-001.jpg',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OCR_SERVICE_URL = testBaseUrl;
  });

  afterEach(() => {
    delete process.env.OCR_SERVICE_URL;
  });

  // -------------------------------------------------------------------------
  // Successful OCR response
  // -------------------------------------------------------------------------

  describe('Successful OCR scan (200)', () => {
    it('should return parsed OcrScanResponse on successful 200 response', async () => {
      // Verified: OCR service at POST /ocr/scan returns the OcrScanResponse contract
      mockAxiosPost.mockResolvedValueOnce({
        status: 200,
        data: successfulOcrResponse,
      });

      const result = await callOcrService(validPayload, testBaseUrl);

      expect(result.scan_id).toBe('svc-scan-uuid-001');
      expect(result.status).toBe('completed');
      expect(result.confidence).toBe(0.87);
      expect(result.claim_ready).toBe(true);
    });

    it('should return extracted_fields from the OCR response', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        status: 200,
        data: successfulOcrResponse,
      });

      const result = await callOcrService(validPayload, testBaseUrl);

      expect(result.extracted_fields.origin_crs).toBe('PAD');
      expect(result.extracted_fields.destination_crs).toBe('BRI');
      expect(result.extracted_fields.travel_date).toBe('2026-03-15');
      expect(result.extracted_fields.departure_time).toBe('14:30');
    });

    it('should call POST /ocr/scan on the correct base URL', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        status: 200,
        data: successfulOcrResponse,
      });

      await callOcrService(validPayload, testBaseUrl);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${testBaseUrl}/ocr/scan`,
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should send the correct request body shape to POST /ocr/scan', async () => {
      // AC-3: Payload must include image_url, user_id, content_type, correlation_id
      mockAxiosPost.mockResolvedValueOnce({
        status: 200,
        data: successfulOcrResponse,
      });

      await callOcrService(validPayload, testBaseUrl);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          image_url: validPayload.image_url,
          user_id: validPayload.user_id,
          content_type: validPayload.content_type,
          correlation_id: validPayload.correlation_id,
        }),
        expect.any(Object)
      );
    });

    it('should set a request timeout of 10000ms', async () => {
      // Spec FR-7: OCR call timeout = 10 seconds
      mockAxiosPost.mockResolvedValueOnce({
        status: 200,
        data: successfulOcrResponse,
      });

      await callOcrService(validPayload, testBaseUrl);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ timeout: 10000 })
      );
    });
  });

  // -------------------------------------------------------------------------
  // OCR service unavailable (503)
  // -------------------------------------------------------------------------

  describe('OCR service unavailable (503)', () => {
    it('should throw an error when OCR service responds with 503', async () => {
      // AC-22: 503 must propagate as error so caller can apply fallback
      const error503 = Object.assign(new Error('Request failed with status code 503'), {
        response: { status: 503, data: { error: 'GCV OCR unavailable' } },
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(error503);

      await expect(callOcrService(validPayload, testBaseUrl)).rejects.toThrow();
    });

    it('should log the OCR failure with correlation_id on 503', async () => {
      // AC-22: Observability — log warning on failure (ADR-002)
      const error503 = Object.assign(new Error('Request failed with status code 503'), {
        response: { status: 503 },
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(error503);

      await expect(callOcrService(validPayload, testBaseUrl)).rejects.toThrow();

      expect(sharedLogger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          correlationId: 'corr-svc-001',
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------

  describe('OCR service timeout', () => {
    it('should throw a timeout error when OCR call exceeds 10 seconds', async () => {
      // AC-22: Timeout (>10s) must propagate so caller can fall back
      const timeoutError = Object.assign(new Error('timeout of 10000ms exceeded'), {
        code: 'ECONNABORTED',
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(timeoutError);

      await expect(callOcrService(validPayload, testBaseUrl)).rejects.toThrow(/timeout/i);
    });
  });

  // -------------------------------------------------------------------------
  // Network errors (ECONNREFUSED, DNS failure)
  // -------------------------------------------------------------------------

  describe('Network errors', () => {
    it('should throw a network error when OCR service is unreachable (ECONNREFUSED)', async () => {
      // AC-22: Network errors must propagate to caller
      const networkError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3010'), {
        code: 'ECONNREFUSED',
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(networkError);

      await expect(callOcrService(validPayload, testBaseUrl)).rejects.toThrow(/ECONNREFUSED/i);
    });

    it('should throw an error when OCR service DNS cannot be resolved', async () => {
      // AC-22: DNS failure must propagate
      const dnsError = Object.assign(
        new Error('getaddrinfo ENOTFOUND railrepay-ocr.railway.internal'),
        {
          code: 'ENOTFOUND',
          isAxiosError: true,
        }
      );
      mockAxiosPost.mockRejectedValueOnce(dnsError);

      await expect(callOcrService(validPayload, testBaseUrl)).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // AC-25: OCR_SERVICE_URL environment variable
  // -------------------------------------------------------------------------

  describe('AC-25: OCR_SERVICE_URL environment variable', () => {
    it('should use OCR_SERVICE_URL env var as base URL when no explicit baseUrl is passed', async () => {
      // AC-25: When called without explicit baseUrl, service reads OCR_SERVICE_URL
      process.env.OCR_SERVICE_URL = 'http://railrepay-ocr.railway.internal:3010';

      mockAxiosPost.mockResolvedValueOnce({
        status: 200,
        data: successfulOcrResponse,
      });

      await callOcrService(validPayload);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://railrepay-ocr.railway.internal:3010/ocr/scan',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should use the default OCR URL when OCR_SERVICE_URL is not set', async () => {
      // AC-25: Default value = http://railrepay-ocr.railway.internal:3010
      delete process.env.OCR_SERVICE_URL;

      mockAxiosPost.mockResolvedValueOnce({
        status: 200,
        data: successfulOcrResponse,
      });

      await callOcrService(validPayload);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://railrepay-ocr.railway.internal:3010/ocr/scan',
        expect.any(Object),
        expect.any(Object)
      );
    });
  });
});
