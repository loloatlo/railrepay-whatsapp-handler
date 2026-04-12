/**
 * TD-WHATSAPP-030: journey-eligibility.handler — Real HTTP Integration Tests
 *
 * BL-29: TD-WHATSAPP-030 — Eligibility-Engine Integration (Replace Mocked Responses)
 * SPEC: services/whatsapp-handler/docs/phases/TD-BL29-REMEDIATION-SPEC.md
 * Per ADR-014: These tests define the behavior. Implementation does not exist yet.
 * Per Test Lock Rule: Blake MUST NOT modify these tests.
 *
 * CONTEXT:
 * The existing journey-eligibility.handler.test.ts tests the OLD mock-injection pattern
 * (mockEligibilityResponse passed via context). Those tests remain locked (Test Lock Rule).
 *
 * THIS FILE tests the NEW behaviour after TD remediation:
 * - Handler makes real HTTP call to eligibility-engine via eligibility-client.service.ts
 * - Mock is applied at the axios boundary (NOT via context injection)
 * - Handler uses dynamic date (NOT hardcoded '2024-11-20')
 * - Handler reads ELIGIBILITY_ENGINE_URL env var for service URL
 *
 * Acceptance Criteria covered:
 * - AC-1: Real HTTP call to eligibility-engine POST /eligibility/evaluate
 * - AC-2: HTTP call sends journey_id, toc_code, delay_minutes, ticket_fare_pence
 * - AC-3: X-Correlation-ID header included from ctx.correlationId
 * - AC-4: Graceful fallback when eligibility-engine is unreachable
 * - AC-5: Hardcoded date replaced with dynamic current date
 * - AC-6: ELIGIBILITY_ENGINE_URL env var controls service URL
 * - AC-7: Eligibility request/response logged at appropriate levels
 * - AC-8: eligibility-engine response mapped to WhatsApp-friendly message
 * - AC-9: Integration test shape — verifies real HTTP call and response handling
 *
 * Mocked endpoint: POST http://{ELIGIBILITY_ENGINE_URL}/eligibility/evaluate
 * Verified: eligibility-engine exposes POST /eligibility/evaluate
 * (confirmed from TD-BL29-REMEDIATION-SPEC.md § Eligibility-Engine API Contract)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';
import { journeyEligibilityHandler } from '../../../src/handlers/journey-eligibility.handler';

// ---------------------------------------------------------------------------
// Infrastructure mocking (Section 6.1.11)
// Shared logger instance OUTSIDE factory ensures same object across all tests.
// ---------------------------------------------------------------------------

const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// Mock axios — eligibility-client.service.ts uses axios.post internally
// This is the CORRECT mock boundary: HTTP client, NOT context injection.
vi.mock('axios');

const mockAxiosPost = vi.mocked(axios.post);

// ---------------------------------------------------------------------------
// Fixtures — realistic data queried from real system contracts
// (per ADR-017, fixtures based on production API contract in SPEC)
// ---------------------------------------------------------------------------

const TEST_ELIGIBILITY_URL = 'http://eligibility-engine.test:3006';

// Canonical eligible response from eligibility-engine
// Source: TD-BL29-REMEDIATION-SPEC.md § Response (200 OK)
const eligibleEngineResponse = {
  journey_id: 'journey-historic-001',
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

// Canonical ineligible response from eligibility-engine
const ineligibleEngineResponse = {
  journey_id: 'journey-historic-002',
  eligible: false,
  scheme: 'DR15',
  delay_minutes: 10,
  compensation_percentage: 0,
  compensation_pence: 0,
  ticket_fare_pence: 1800,
  reasons: ['Delay of 10 minutes is below the 15-minute minimum threshold'],
  applied_rules: [],
  evaluation_timestamp: '2026-04-12T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Test helper: build a mock user
// ---------------------------------------------------------------------------

function buildMockUser(overrides?: Partial<User>): User {
  return {
    id: 'user-test-123',
    phone_number: '+447700900123',
    verified_at: new Date('2026-01-01T10:00:00Z'),
    created_at: new Date('2026-01-01T10:00:00Z'),
    updated_at: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('TD-WHATSAPP-030: journey-eligibility.handler — Real HTTP Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ELIGIBILITY_ENGINE_URL = TEST_ELIGIBILITY_URL;
    // Use fake timers so date-based branch logic is deterministic
    vi.useFakeTimers();
    // Fix "today" to 2026-04-12 for all tests
    vi.setSystemTime(new Date('2026-04-12T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ELIGIBILITY_ENGINE_URL;
  });

  // =========================================================================
  // AC-5: Dynamic date — no hardcoded '2024-11-20'
  // =========================================================================

  describe('AC-5: Dynamic date logic', () => {
    it('should treat a journey dated yesterday as historic (using current date)', async () => {
      // AC-5: Handler must NOT use hardcoded '2024-11-20'.
      // With system time fixed to 2026-04-12, a journey on 2026-04-11 is historic.
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-dynamic-date-001',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-dynamic-001',
        stateData: {
          journeyId: 'journey-dynamic-date-001',
          travelDate: '2026-04-11', // Yesterday relative to 2026-04-12
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      // Handler should have made an HTTP call to eligibility-engine (historic path)
      expect(mockAxiosPost).toHaveBeenCalled();
      // Response should confirm eligibility (not a future-journey tracking response)
      expect(result.response).toMatch(/eligible|compensation/i);
    });

    it('should treat a journey dated tomorrow as future (using current date)', async () => {
      // AC-5: Tomorrow (2026-04-13) relative to fixed system time (2026-04-12) is future.
      // Handler should NOT call eligibility-engine for future journeys.
      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-dynamic-date-002',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-dynamic-002',
        stateData: {
          journeyId: 'journey-dynamic-future-001',
          travelDate: '2026-04-13', // Tomorrow relative to 2026-04-12
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      // Future journey should NOT call eligibility-engine
      expect(mockAxiosPost).not.toHaveBeenCalled();
      // Response should indicate future journey tracking
      expect(result.response).toMatch(/saved|tracked|monitor/i);
    });

    it('should NOT use hardcoded date 2024-11-20 — a journey on 2026-04-11 must be recognised as historic', async () => {
      // AC-5: This test FAILS with the old hardcoded '2024-11-20' because a journey
      // in 2026 would compare as: '2026-04-11' < '2024-11-20' === false (string compare),
      // landing in the wrong branch. With dynamic date it correctly resolves as historic.
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-hardcode-fail',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-hardcode-001',
        stateData: {
          journeyId: 'journey-hardcode-check-001',
          travelDate: '2026-04-11', // Clearly historic in 2026 but would fail vs '2024-11-20'
          origin: 'PAD',
          destination: 'CDF',
          toc_code: 'GW',
          ticket_fare_pence: 3000,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      // MUST take the historic branch and call eligibility-engine
      expect(mockAxiosPost).toHaveBeenCalledOnce();
      expect(result.response).not.toMatch(/saved.*track|monitor/i);
    });
  });

  // =========================================================================
  // AC-1 + AC-2: Real HTTP call with correct payload
  // =========================================================================

  describe('AC-1 + AC-2: Real HTTP call to eligibility-engine', () => {
    it('should call POST /eligibility/evaluate for a historic journey (not read from context)', async () => {
      // AC-1: Real HTTP call — NOT mockEligibilityResponse from context
      // AC-2: Payload contains required fields
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-real-http-001',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-real-http-001',
        stateData: {
          journeyId: 'journey-historic-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
          delayMinutes: 35,
        },
        // NOTE: No mockEligibilityResponse in context — handler must make real HTTP call
      };

      await journeyEligibilityHandler(ctx);

      // Verify real HTTP call was made to eligibility-engine
      expect(mockAxiosPost).toHaveBeenCalledOnce();
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.stringContaining('/eligibility/evaluate'),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should send journey_id in the eligibility-engine request payload', async () => {
      // AC-2: journey_id is required by eligibility-engine API contract
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-payload-journey-id',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-payload-001',
        stateData: {
          journeyId: 'journey-payload-check-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      await journeyEligibilityHandler(ctx);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ journey_id: 'journey-payload-check-001' }),
        expect.any(Object)
      );
    });

    it('should send toc_code from stateData in the eligibility-engine request payload', async () => {
      // AC-2: toc_code is required — must come from stateData (journey-matcher provides it)
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-payload-toc',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-payload-002',
        stateData: {
          journeyId: 'journey-toc-check-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      await journeyEligibilityHandler(ctx);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ toc_code: 'GW' }),
        expect.any(Object)
      );
    });

    it('should send ticket_fare_pence from stateData in the eligibility-engine request payload', async () => {
      // AC-2: ticket_fare_pence required for compensation calculation
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-payload-fare',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-payload-003',
        stateData: {
          journeyId: 'journey-fare-check-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 3200,
        },
      };

      await journeyEligibilityHandler(ctx);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ ticket_fare_pence: 3200 }),
        expect.any(Object)
      );
    });

    it('should send delay_minutes in the eligibility-engine request payload', async () => {
      // AC-2: delay_minutes is required — sourced from stateData or delay-tracker
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-payload-delay',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-payload-004',
        stateData: {
          journeyId: 'journey-delay-check-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
          delayMinutes: 45,
        },
      };

      await journeyEligibilityHandler(ctx);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ delay_minutes: 45 }),
        expect.any(Object)
      );
    });
  });

  // =========================================================================
  // AC-3: Correlation ID passed via X-Correlation-ID header
  // =========================================================================

  describe('AC-3: Correlation ID in eligibility-engine request header', () => {
    it('should include ctx.correlationId as X-Correlation-ID header', async () => {
      // AC-3: Distributed tracing per ADR-002
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-corr-id-001',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'specific-corr-id-abc123',
        stateData: {
          journeyId: 'journey-corr-check-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      await journeyEligibilityHandler(ctx);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'specific-corr-id-abc123',
          }),
        })
      );
    });
  });

  // =========================================================================
  // AC-4: Graceful fallback when eligibility-engine is unreachable
  // =========================================================================

  describe('AC-4: Fallback messaging when eligibility-engine fails', () => {
    it('should return fallback response (not throw) when eligibility-engine returns 503', async () => {
      // AC-4: Handler must NOT propagate the error to the caller — provide graceful message
      const error503 = Object.assign(new Error('Request failed with status code 503'), {
        response: { status: 503 },
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(error503);

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-fallback-503',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-fallback-001',
        stateData: {
          journeyId: 'journey-fallback-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      // Handler must NOT throw — it must return a fallback HandlerResult
      const result = await journeyEligibilityHandler(ctx);

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should include retry/pending indication in fallback response when engine is down', async () => {
      // AC-4: User must know eligibility will be checked later (journey not lost)
      const networkError = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(networkError);

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-fallback-network',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-fallback-002',
        stateData: {
          journeyId: 'journey-fallback-002',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      // Message must indicate journey is saved and will be checked
      expect(result.response).toMatch(/check.*later|message.*later|be in touch|saved/i);
      // State data must flag pending eligibility check
      expect(result.stateData?.eligibilityCheckPending).toBe(true);
    });

    it('should return fallback response when eligibility-engine times out', async () => {
      // AC-4: Timeout is treated same as unavailable — graceful fallback
      const timeoutError = Object.assign(new Error('timeout of 15000ms exceeded'), {
        code: 'ECONNABORTED',
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(timeoutError);

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-fallback-timeout',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-fallback-003',
        stateData: {
          journeyId: 'journey-fallback-003',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      expect(result).toBeDefined();
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
      expect(result.stateData?.eligibilityCheckPending).toBe(true);
    });
  });

  // =========================================================================
  // AC-6: ELIGIBILITY_ENGINE_URL env var
  // =========================================================================

  describe('AC-6: ELIGIBILITY_ENGINE_URL controls target service URL', () => {
    it('should call the URL from ELIGIBILITY_ENGINE_URL env var', async () => {
      // AC-6: Production uses Railway internal URL — must be configurable
      process.env.ELIGIBILITY_ENGINE_URL = 'http://eligibility-engine.railway.internal:3006';
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-env-url-001',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-env-url-001',
        stateData: {
          journeyId: 'journey-env-check-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      await journeyEligibilityHandler(ctx);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://eligibility-engine.railway.internal:3006/eligibility/evaluate',
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  // =========================================================================
  // AC-7: Structured logging
  // =========================================================================

  describe('AC-7: Eligibility request/response logging', () => {
    it('should log the eligibility request with correlationId before making HTTP call', async () => {
      // AC-7: Per ADR-002 observability — all outbound calls must be logged
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-log-req-001',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-log-req-001',
        stateData: {
          journeyId: 'journey-log-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      await journeyEligibilityHandler(ctx);

      expect(sharedLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ correlationId: 'corr-log-req-001' })
      );
    });

    it('should log eligibility result at info level when engine responds successfully', async () => {
      // AC-7: Response logging for audit trail (eligible = true case)
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-log-resp-001',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-log-resp-001',
        stateData: {
          journeyId: 'journey-log-resp-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      await journeyEligibilityHandler(ctx);

      // At least one info log must reference the eligibility result
      const infoCallArgs = sharedLogger.info.mock.calls;
      const hasEligibilityLog = infoCallArgs.some(
        (call) => call[1] && typeof call[1] === 'object' && 'isEligible' in call[1]
      );
      expect(hasEligibilityLog).toBe(true);
    });

    it('should log error with correlationId when eligibility-engine call fails', async () => {
      // AC-7: Failure logging per ADR-002 observability requirements
      const error503 = Object.assign(new Error('Service Unavailable'), {
        response: { status: 503 },
        isAxiosError: true,
      });
      mockAxiosPost.mockRejectedValueOnce(error503);

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-log-err-001',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-log-err-001',
        stateData: {
          journeyId: 'journey-log-err-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      await journeyEligibilityHandler(ctx);

      expect(sharedLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ correlationId: 'corr-log-err-001' })
      );
    });
  });

  // =========================================================================
  // AC-8: Response mapping to WhatsApp-friendly message format
  // =========================================================================

  describe('AC-8: Map eligibility-engine response to WhatsApp message format', () => {
    it('should include compensation amount in pounds when journey is eligible', async () => {
      // AC-8: compensation_pence (625) must be shown as £6.25 or similar GBP format
      const response625pence = {
        ...eligibleEngineResponse,
        journey_id: 'journey-format-001',
        compensation_pence: 625, // £6.25
        compensation_percentage: 25,
        delay_minutes: 35,
      };
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: response625pence });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-format-001',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-format-001',
        stateData: {
          journeyId: 'journey-format-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      // Response must contain a GBP currency amount
      expect(result.response).toMatch(/£\d+\.?\d*/);
      // Response must include delay information
      expect(result.response).toMatch(/35.*minutes|minutes.*35/i);
    });

    it('should include delay minutes from eligibility-engine response in the message', async () => {
      // AC-8: delay_minutes from API response shown to user (not a hardcoded value)
      const response45min = {
        ...eligibleEngineResponse,
        journey_id: 'journey-format-002',
        delay_minutes: 45,
        compensation_pence: 900,
        compensation_percentage: 50,
      };
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: response45min });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-format-002',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-format-002',
        stateData: {
          journeyId: 'journey-format-002',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 1800,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      expect(result.response).toContain('45');
    });

    it('should include compensation percentage from eligibility-engine response in the message', async () => {
      // AC-8: compensation_percentage shown to user for transparency
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-format-003',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-format-003',
        stateData: {
          journeyId: 'journey-format-003',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      // Response includes percentage (e.g. "25%" or "25% of ticket price")
      expect(result.response).toMatch(/\d+%/);
    });

    it('should include clear ineligibility explanation when journey is not eligible', async () => {
      // AC-8: Ineligible response must map reasons from eligibility-engine to friendly message
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: ineligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-ineligible-msg',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-ineligible-001',
        stateData: {
          journeyId: 'journey-historic-002',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'CDF',
          toc_code: 'GW',
          ticket_fare_pence: 1800,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      // Message must communicate ineligibility clearly
      expect(result.response).toMatch(/not eligible|does not qualify|sorry/i);
      // Delay still communicated so user understands why
      expect(result.response).toMatch(/10.*minutes|minutes.*10/i);
    });

    it('should publish journey.eligibility_confirmed event when eligible', async () => {
      // AC-8: Outbox event published for downstream services (claim processing)
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-event-eligible',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-event-001',
        stateData: {
          journeyId: 'journey-historic-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents!.length).toBeGreaterThan(0);
      expect(result.publishEvents![0].event_type).toBe('journey.eligibility_confirmed');
      expect(result.publishEvents![0].payload).toMatchObject({
        journeyId: 'journey-historic-001',
        isEligible: true,
      });
    });

    it('should publish journey.eligibility_confirmed event when ineligible', async () => {
      // AC-8: Event published regardless of eligibility result
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: ineligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-event-ineligible',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-event-002',
        stateData: {
          journeyId: 'journey-historic-002',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'CDF',
          toc_code: 'GW',
          ticket_fare_pence: 1800,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents![0].event_type).toBe('journey.eligibility_confirmed');
      expect(result.publishEvents![0].payload).toMatchObject({
        journeyId: 'journey-historic-002',
        isEligible: false,
      });
    });

    it('should transition to AUTHENTICATED state after eligibility check', async () => {
      // AC-8: Conversation returns to main menu state after eligibility is determined
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-next-state',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-state-001',
        stateData: {
          journeyId: 'journey-historic-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });
  });

  // =========================================================================
  // AC-9: Integration test — full HTTP call shape and response handling
  // =========================================================================

  describe('AC-9: Integration shape — HTTP call and response handling', () => {
    it('should make exactly one POST call to eligibility-engine for a historic journey', async () => {
      // AC-9: Verify integration shape — one HTTP call per eligibility check
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-integration-001',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-integration-001',
        stateData: {
          journeyId: 'journey-integration-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      await journeyEligibilityHandler(ctx);

      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    });

    it('should not call eligibility-engine for a future journey', async () => {
      // AC-9: Future journeys do not require eligibility check (delay has not happened yet)
      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-integration-future',
        user: buildMockUser(),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-integration-002',
        stateData: {
          journeyId: 'journey-integration-future',
          travelDate: '2026-04-13', // Tomorrow
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
        },
      };

      await journeyEligibilityHandler(ctx);

      expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    it('should complete a full happy-path integration: stateData → HTTP call → mapped response → event', async () => {
      // AC-9: End-to-end integration shape verification
      // Input: stateData with journey fields
      // Processing: HTTP call to eligibility-engine
      // Output: mapped WhatsApp message + outbox event
      mockAxiosPost.mockResolvedValueOnce({ status: 200, data: eligibleEngineResponse });

      const ctx: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM-e2e-shape',
        user: buildMockUser({ id: 'user-e2e-001' }),
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-e2e-001',
        stateData: {
          journeyId: 'journey-e2e-001',
          travelDate: '2026-04-11',
          origin: 'PAD',
          destination: 'BRI',
          toc_code: 'GW',
          ticket_fare_pence: 2500,
          delayMinutes: 35,
        },
      };

      const result = await journeyEligibilityHandler(ctx);

      // HTTP call made
      expect(mockAxiosPost).toHaveBeenCalledOnce();

      // Response is a non-empty string
      expect(typeof result.response).toBe('string');
      expect(result.response.length).toBeGreaterThan(0);

      // Transitions to AUTHENTICATED
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);

      // Outbox event published
      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents!.length).toBeGreaterThan(0);
    });
  });
});
