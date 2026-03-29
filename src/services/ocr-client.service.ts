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
import https from 'https';
import http from 'http';
import { createLogger } from '@railrepay/winston-logger';

const DEFAULT_OCR_URL = 'http://railrepay-ocr.railway.internal:3010';
const OCR_TIMEOUT_MS = 10000;

/**
 * Download media from a Twilio URL using Basic Auth.
 * Uses native http/https modules (not axios) to avoid mock conflicts in tests.
 */
async function downloadTwilioMedia(mediaUrl: string): Promise<string> {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
  const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(mediaUrl);
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const auth = twilioSid && twilioToken ? `${twilioSid}:${twilioToken}` : undefined;

    const req = transport.get(
      { ...parsedUrl, auth, timeout: OCR_TIMEOUT_MS } as any,
      (res) => {
        // Follow redirects (Twilio may 302)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadTwilioMedia(res.headers.location).then(resolve, reject);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Twilio media download failed: HTTP ${res.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Twilio media download timed out'));
    });
  });
}

export interface OcrScanPayload {
  image_url?: string;
  image_base64?: string;
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
    // If image_url is provided (Twilio media URL), download with Basic Auth
    // and convert to base64 so the OCR service doesn't need Twilio credentials.
    // Uses https/http modules (not axios) to avoid conflicts with axios mocks in tests.
    let ocrBody: Record<string, unknown> = { ...payload };

    if (payload.image_url && !payload.image_base64 && process.env.TWILIO_ACCOUNT_SID) {
      logger.info('Downloading image from Twilio', {
        correlationId: payload.correlation_id,
        mediaUrl: payload.image_url,
      });

      try {
        const imageBase64 = await downloadTwilioMedia(payload.image_url);
        logger.info('Twilio image downloaded successfully', {
          correlationId: payload.correlation_id,
          base64Length: imageBase64.length,
        });
        ocrBody = {
          image_base64: imageBase64,
          user_id: payload.user_id,
          content_type: payload.content_type,
          correlation_id: payload.correlation_id,
        };
      } catch (downloadError: any) {
        logger.warn('Twilio image download failed', {
          correlationId: payload.correlation_id,
          errorMessage: downloadError?.message || String(downloadError),
          errorCode: downloadError?.code,
        });
        throw downloadError;
      }
    }

    logger.info('Sending OCR request', {
      correlationId: payload.correlation_id,
      url,
      hasBase64: !!ocrBody.image_base64,
      hasImageUrl: !!ocrBody.image_url,
    });

    const response = await axios.post<OcrScanResponse>(url, ocrBody, {
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
