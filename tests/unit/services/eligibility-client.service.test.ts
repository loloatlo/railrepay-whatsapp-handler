/**
 * Eligibility Client Service Tests - Written FIRST per ADR-014 (TDD)
 *
 * BL-29: TD-WHATSAPP-030 — Eligibility-Engine Integration (Replace Mocked Responses)
 * SPEC: services/whatsapp-handler/docs/phases/TD-BL29-REMEDIATION-SPEC.md
 * Per ADR-014: These tests define the behavior. Implementation does not exist yet.
 * Per Test Lock Rule: Blake MUST NOT modify these tests.
 *
 * Module under test: src/services/eligibility-client.service.ts (Blake will create)
 * Public API: callEligibilityService(payload, correlationId, baseUrl?) → EligibilityResponse
 *
 * Mocked endpoint: POST http://{baseUrl}/eligibility/evaluate
 * Verified: eligibility-engine exposes POST /eligibility/evaluate
 * Source: TD-BL29-REMEDIATION-SPEC.md § Eligibility-Engine API Contract
 *
 * Acceptance Criteria covered:
 * - AC-1: Create eligibility-client.service.ts following ocr-client.service.ts pattern
 * - AC-3: Pass correlation ID from conversation context to eligibility-engine
 * - AC-4: Handle eligibility-engine errors with fallback messaging
 * - AC-5: Replace hardcoded date with dynamic date logic (not in this file — see handler test)
 * - AC-6: Configure ELIGIBILITY_ENGINE_URL env var with Railway internal URL
 * - AC-7: Log eligibility request/response at appropriate levels
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';

// Infrastructure package mocking per Section 6.1.11
// Shared logger instance must be created OUTSIDE the factory so the same
// object is returned on every createLogger() call across all tests.
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// Mock axios at module level — no real HTTP calls
vi.mock('axios');

const mockAxiosPost = vi.mocked(axios.post);

// AC-1: This import will fail until Blake creates the file (expected RED state)
// Verified: eligibility-engine exposes POST /eligibility/evaluate
// (confirmed from TD-BL29-REMEDIATION-SPEC.md § Eligibility-Engine API Contract)
import {
  callEligibilityService,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type EligibilityRequest,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type EligibilityResponse,
} from '../../../src/services/eligibility-client.service';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const TEST_BASE_URL = 'http://eligibility-engine.test:3006';

const validRequest: EligibilityRequest = {
  journey_id: 'journey-test-uuid-001',
  toc_code: 'GW',
  delay_minutes: 35,
  ticket_fare_pence: 2500,
};

const eligibleApiResponse: EligibilityResponse = {
  journey_id: 'journey-test-uuid-001',
  eligible: true,
  scheme: 'DR15',
  delay_minutes: 35,
  compensation_percentage: 25,
  compensation_pence: 625,
  ticket_fare_pence: 2500,
  reasons: ['Delay of 35 minutes qualifies for 25% refund under DR15 scheme'],
  applied_rules: ['DR15_30MIN_25PCT'],
  evaluation_timestamp: '2026-04-12T10:00:00.000Z',
};

const ineligibleApiResponse: EligibilityResponse = {
  journey_id: 'journey-test-uuid-002',
  eligible: false,
  scheme: 'DR15',
  delay_minutes: 10,
  compensation_percentage: 0,
  compensation_pence: 0,
  ticket_fare_pence: 2500,
  reasons: ['Delay of 10 minutes is below the 15-minute minimum threshold'],
  applied_rules: [],
  evaluation_timestamp: '2026-04-12T10:00:00.000Z',
};

// ---------------------------------------------------------------------------

describe('TD-WHATSAPP-030: Eligibility Client Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ELIGIBILITY_ENGINE_URL = TEST_BASE_URL;
  });

  afterEach(() => {
    delete process.env.ELIGIBILITY_ENGINE_URL;
  });

  // -------------------------------------------------------------------------
  // AC-1: Service exists and follows ocr-client.service.ts pattern
  // -------------------------------------------------------------------------

  describe('AC-1: Service module shape', () => {
    it('should export a callEligibilityService function', () => {
      expect(callEligibilityService).toBeDefined();
      expect(typeof callEligibilityService).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Successful eligibility evaluation
  // -------------------------------------------------------------------------

  describe('Successful eligibility evaluation (200)', () => {
    it('should return parsed EligibilityResponse on successful 200 response', async () => {
      // AC-1: Service wraps HTTP call and returns typed response
      mockAxiosPost.mockResolvedValueOnce({
        status: 200,
        data: eligibleApiResponse,
      });

      const result = await callEligibilityService(
        validRequest,
        'corr-test-001',
        TEST_BASE_URL
      );

      expect(result.journey_id).toBe('journey-test-uuid-001');
      expect(result.eligible).toBe(true);
      expect(result.scheme).toBe('DR15');
      expect(result.compensation_pence).toBe(625);
      expect(result.compensation_percentage).toBe(25);
    });

    it('should return ineligible result when delay is below threshold', async () => {
      // AC-1: Service correctly propagates ineligible responses
      const ineligibleRequest: EligibilityRequest = {
        journey_id: 'journey-test-uuid-002',
        toc_code: 'GW',
        delay_minutes: 10,
        ticket_fare_pence: 2500,
      };

      mockAxiosPost.mockResolvedValueOnce({
        status: 200,
        data: ineligibleApiResponse,
      });

      const result = await callEligibilityService(
        ineligibleRequest,
        'corr-test-002',
        TEST_BASE_URL
      );

      expect(result.eligible).toBe(false);
      expect(result.compensation_pence).toBe(0);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toMatch(/threshold/i);
    });

    it('should call POST /eligibility/evaluate on the configured base URL', async () => {
      // AC-1: Correct endpoint called
      // Verified: eligibility-engine exposes POST /eligibility/evaluate
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleApiResponse });

      await callEligibilityService(validRequest, 'corr-test-003', TEST_BASE_URL);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/eligibility/evaluate`,
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC-2 (handler-level) / AC-1: Correct request payload shape
  // -------------------------------------------------------------------------

  describe('Request payload construction', () => {
    it('should send journey_id, toc_code, delay_minutes and ticket_fare_pence to eligibility-engine', async () => {
      // AC-1: Required fields from spec § Eligibility-Engine API Contract
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleApiResponse });

      await callEligibilityService(validRequest, 'corr-payload-001', TEST_BASE_URL);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          journey_id: 'journey-test-uuid-001',
          toc_code: 'GW',
          delay_minutes: 35,
          ticket_fare_pence: 2500,
        }),
        expect.any(Object)
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC-3: Correlation ID passed via X-Correlation-ID header
  // -------------------------------------------------------------------------

  describe('AC-3: Correlation ID propagation', () => {
    it('should include X-Correlation-ID header in the request', async () => {
      // AC-3: Distributed tracing per ADR-002
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleApiResponse });

      await callEligibilityService(validRequest, 'corr-header-001', TEST_BASE_URL);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'corr-header-001',
          }),
        })
      );
    });

    it('should pass a different correlation ID for each call independently', async () => {
      // AC-3: Each call uses its own correlation ID (no leakage between calls)
      mockAxiosPost.mockResolvedValue({ status: 200, data: eligibleApiResponse });

      await callEligibilityService(validRequest, 'corr-first', TEST_BASE_URL);
      await callEligibilityService(validRequest, 'corr-second', TEST_BASE_URL);

      const firstCallHeaders = mockAxiosPost.mock.calls[0][2] as any;
      const secondCallHeaders = mockAxiosPost.mock.calls[1][2] as any;

      expect(firstCallHeaders.headers['X-Correlation-ID']).toBe('corr-first');
      expect(secondCallHeaders.headers['X-Correlation-ID']).toBe('corr-second');
    });
  });

  // -------------------------------------------------------------------------
  // AC-4: Error handling — service unavailable / timeout
  // -------------------------------------------------------------------------

  describe('AC-4: Error handling — eligibility-engine unreachable', () => {
    it('should throw when eligibility-engine returns 503', async () => {
      // AC-4: Caller (handler) catches this and applies fallback messaging
      const error503 = Object.assign(new Error('Request failed with status code 503'), {
        response: { status: 503, data: { error: 'Service Unavailable' } },
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(error503);

      await expect(
        callEligibilityService(validRequest, 'corr-503-001', TEST_BASE_URL)
      ).rejects.toThrow();
    });

    it('should throw when eligibility-engine returns 500', async () => {
      // AC-4: 5xx errors propagated so handler can fall back
      const error500 = Object.assign(new Error('Request failed with status code 500'), {
        response: { status: 500, data: { error: 'Internal Server Error' } },
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(error500);

      await expect(
        callEligibilityService(validRequest, 'corr-500-001', TEST_BASE_URL)
      ).rejects.toThrow();
    });

    it('should throw a timeout error when eligibility-engine call exceeds timeout', async () => {
      // AC-4: Network timeout propagated for graceful fallback
      const timeoutError = Object.assign(new Error('timeout exceeded'), {
        code: 'ECONNABORTED',
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(timeoutError);

      await expect(
        callEligibilityService(validRequest, 'corr-timeout-001', TEST_BASE_URL)
      ).rejects.toThrow();
    });

    it('should throw when eligibility-engine is unreachable (ECONNREFUSED)', async () => {
      // AC-4: Network connectivity error propagated
      const connRefused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3006'), {
        code: 'ECONNREFUSED',
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(connRefused);

      await expect(
        callEligibilityService(validRequest, 'corr-conn-refused', TEST_BASE_URL)
      ).rejects.toThrow();
    });

    it('should throw when eligibility-engine returns 400 (bad request)', async () => {
      // AC-4: 4xx validation errors also propagated — invalid payload is a bug
      const error400 = Object.assign(new Error('Request failed with status code 400'), {
        response: {
          status: 400,
          data: { error: 'toc_code is required' },
        },
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(error400);

      await expect(
        callEligibilityService(validRequest, 'corr-400-001', TEST_BASE_URL)
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // AC-6: ELIGIBILITY_ENGINE_URL env var configuration
  // -------------------------------------------------------------------------

  describe('AC-6: ELIGIBILITY_ENGINE_URL environment variable', () => {
    it('should use ELIGIBILITY_ENGINE_URL env var when no baseUrl argument provided', async () => {
      // AC-6: URL configurable via env var (Railway internal URL in production)
      process.env.ELIGIBILITY_ENGINE_URL = 'http://eligibility-engine.railway.internal:3006';
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleApiResponse });

      await callEligibilityService(validRequest, 'corr-env-001');

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://eligibility-engine.railway.internal:3006/eligibility/evaluate',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should fall back to http://localhost:3006 when ELIGIBILITY_ENGINE_URL is not set', async () => {
      // AC-6: Safe local dev default when env var absent
      delete process.env.ELIGIBILITY_ENGINE_URL;
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleApiResponse });

      await callEligibilityService(validRequest, 'corr-default-001');

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://localhost:3006/eligibility/evaluate',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should prefer explicit baseUrl argument over env var', async () => {
      // AC-6: Allows test injection of a custom base URL
      process.env.ELIGIBILITY_ENGINE_URL = 'http://env-url.internal:3006';
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleApiResponse });

      await callEligibilityService(validRequest, 'corr-override-001', 'http://explicit-url.test:3006');

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://explicit-url.test:3006/eligibility/evaluate',
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC-7: Logging at appropriate levels
  // -------------------------------------------------------------------------

  describe('AC-7: Structured logging with correlation IDs', () => {
    it('should log eligibility request at info level with correlation ID', async () => {
      // AC-7: Per ADR-002, all service calls must log with correlationId
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleApiResponse });

      await callEligibilityService(validRequest, 'corr-log-001', TEST_BASE_URL);

      expect(sharedLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ correlationId: 'corr-log-001' })
      );
    });

    it('should log eligibility response at info level including eligible flag', async () => {
      // AC-7: Response logging for audit trail
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleApiResponse });

      await callEligibilityService(validRequest, 'corr-log-resp-001', TEST_BASE_URL);

      // At least one info log should include eligibility result context
      const infoCalls = sharedLogger.info.mock.calls;
      const responseLog = infoCalls.find((call) =>
        call[1] && typeof call[1] === 'object' && 'eligible' in call[1]
      );
      expect(responseLog).toBeDefined();
    });

    it('should log warning with correlation ID when eligibility-engine call fails', async () => {
      // AC-7: Failure logging per ADR-002 observability requirements
      const error503 = Object.assign(new Error('Request failed with status code 503'), {
        response: { status: 503 },
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(error503);

      await expect(
        callEligibilityService(validRequest, 'corr-log-fail-001', TEST_BASE_URL)
      ).rejects.toThrow();

      expect(sharedLogger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ correlationId: 'corr-log-fail-001' })
      );
    });
  });
});
