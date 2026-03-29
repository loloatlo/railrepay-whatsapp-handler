/**
 * OCR Client Service — HTTP client for railrepay-ocr service
 *
 * BL-167: TD-WHATSAPP-062-S1 — Core FSM + OCR Call + User Confirmation
 * Per ADR-002: Structured logging with correlation IDs
 * Per AC-25: Reads OCR_SERVICE_URL env var (default: http://railrepay-ocr.railway.internal:3010)
 *
 * Verified: railrepay-ocr service exposes POST /ocr/scan
 */

import axios from 'axios';
import { createLogger } from '@railrepay/winston-logger';

const DEFAULT_OCR_URL = 'http://railrepay-ocr.railway.internal:3010';
const OCR_TIMEOUT_MS = 10000;

export interface OcrScanPayload {
  image_url: string;
  user_id: string;
  content_type: 'image/jpeg' | 'image/png' | 'application/pdf';
  correlation_id: string;
}

export interface OcrExtractedFields {
  origin_station: string | null;
  destination_station: string | null;
  origin_crs: string | null;
  destination_crs: string | null;
  travel_date: string | null;
  departure_time: string | null;
  ticket_type: string | null;
  ticket_class: string | null;
  fare_pence: number | null;
  via_station: string | null;
  via_crs: string | null;
  operator_name: string | null;
}

export interface OcrScanResponse {
  scan_id: string;
  status: string;
  confidence: number;
  extracted_fields: OcrExtractedFields;
  missing_fields: string[];
  claim_ready: boolean;
  ocr_status: string;
  gcs_upload_status: string;
  image_gcs_path: string;
}

/**
 * Call the OCR service to scan a ticket image
 *
 * @param payload - Scan request payload (image_url, user_id, content_type, correlation_id)
 * @param baseUrl - Optional base URL override (defaults to OCR_SERVICE_URL env var)
 * @returns Parsed OcrScanResponse
 * @throws Error if OCR service is unavailable, times out, or returns non-2xx status
 */
export async function callOcrService(
  payload: OcrScanPayload,
  baseUrl?: string
): Promise<OcrScanResponse> {
  const logger = createLogger({
    serviceName: process.env.SERVICE_NAME || 'whatsapp-handler',
    level: process.env.LOG_LEVEL || 'info',
    lokiEnabled: process.env.LOKI_ENABLED === 'true',
    lokiHost: process.env.LOKI_HOST,
    lokiBasicAuth: process.env.LOKI_BASIC_AUTH,
    environment: process.env.NODE_ENV || 'development',
  });

  const resolvedBaseUrl =
    baseUrl ?? process.env.OCR_SERVICE_URL ?? DEFAULT_OCR_URL;

  const url = `${resolvedBaseUrl}/ocr/scan`;

  try {
    const response = await axios.post<OcrScanResponse>(url, payload, {
      timeout: OCR_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  } catch (error: any) {
    logger.warn('OCR service call failed', {
      correlationId: payload.correlation_id,
      url,
      errorMessage: error?.message,
      statusCode: error?.response?.status,
      errorCode: error?.code,
    });

    throw error;
  }
}
