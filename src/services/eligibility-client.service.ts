/**
 * Eligibility Client Service — HTTP client for eligibility-engine
 *
 * BL-29: TD-WHATSAPP-030 — Eligibility-Engine Integration (Replace Mocked Responses)
 * Per ADR-002: Structured logging with correlation IDs
 * Per AC-6: Reads ELIGIBILITY_ENGINE_URL env var (default: http://localhost:3006)
 *
 * Verified: eligibility-engine exposes POST /eligibility/evaluate
 * Source: TD-BL29-REMEDIATION-SPEC.md § Eligibility-Engine API Contract
 */

import axios from 'axios';
import { createLogger } from '@railrepay/winston-logger';

const DEFAULT_ELIGIBILITY_URL = 'http://localhost:3006';
const ELIGIBILITY_TIMEOUT_MS = 15000;

export interface EligibilityRequest {
  journey_id: string;
  toc_code: string;
  delay_minutes: number;
  ticket_fare_pence: number;
}

export interface EligibilityResponse {
  journey_id: string;
  eligible: boolean;
  scheme: string;
  delay_minutes: number;
  compensation_percentage: number;
  compensation_pence: number;
  ticket_fare_pence: number;
  reasons: string[];
  applied_rules: string[];
  evaluation_timestamp: string;
}

/**
 * Call the eligibility-engine to evaluate journey compensation eligibility.
 *
 * @param payload - Eligibility evaluation request payload
 * @param correlationId - Distributed tracing correlation ID (per ADR-002)
 * @param baseUrl - Optional base URL override (defaults to ELIGIBILITY_ENGINE_URL env var)
 * @returns Parsed EligibilityResponse
 * @throws Error if eligibility-engine is unavailable, times out, or returns non-2xx status
 */
export async function callEligibilityService(
  payload: EligibilityRequest,
  correlationId: string,
  baseUrl?: string
): Promise<EligibilityResponse> {
  const logger = createLogger({
    serviceName: process.env.SERVICE_NAME || 'whatsapp-handler',
    level: process.env.LOG_LEVEL || 'info',
    lokiEnabled: process.env.LOKI_ENABLED === 'true',
    lokiHost: process.env.LOKI_HOST,
    lokiBasicAuth: process.env.LOKI_BASIC_AUTH,
    environment: process.env.NODE_ENV || 'development',
  });

  const resolvedBaseUrl =
    baseUrl ?? process.env.ELIGIBILITY_ENGINE_URL ?? DEFAULT_ELIGIBILITY_URL;

  const url = `${resolvedBaseUrl}/eligibility/evaluate`;

  logger.info('Calling eligibility-engine', {
    correlationId,
    url,
    journey_id: payload.journey_id,
    toc_code: payload.toc_code,
    delay_minutes: payload.delay_minutes,
  });

  try {
    const response = await axios.post<EligibilityResponse>(url, payload, {
      timeout: ELIGIBILITY_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
    });

    logger.info('Eligibility-engine response received', {
      correlationId,
      journey_id: payload.journey_id,
      eligible: response.data.eligible,
      compensation_pence: response.data.compensation_pence,
      scheme: response.data.scheme,
    });

    return response.data;
  } catch (error: any) {
    logger.warn('Eligibility-engine call failed', {
      correlationId,
      url,
      errorMessage: error?.message,
      statusCode: error?.response?.status,
      errorCode: error?.code,
      responseBody: error?.response?.data
        ? JSON.stringify(error.response.data).substring(0, 500)
        : undefined,
    });

    throw error;
  }
}
