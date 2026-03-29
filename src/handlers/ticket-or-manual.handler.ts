/**
 * Ticket-or-Manual Handler — AWAITING_TICKET_OR_MANUAL state
 *
 * BL-167: TD-WHATSAPP-062-S1 — Core FSM + OCR Call + User Confirmation
 * Per ADR-002: Structured logging with correlation IDs
 *
 * BEHAVIOR:
 * - Empty / unrecognised text → stay in AWAITING_TICKET_OR_MANUAL, re-send prompt
 * - "MANUAL" keyword → transition to AWAITING_JOURNEY_DATE (clean stateData)
 * - Image/PDF media → call OCR service
 *   - OCR success → store scan data in stateData, transition to AWAITING_OCR_REVIEW
 *   - OCR failure → graceful fallback, transition to AWAITING_JOURNEY_DATE (clean stateData)
 * - Unsupported media type → stay in AWAITING_TICKET_OR_MANUAL, send error
 *
 * Supported media content types: image/jpeg, image/png, application/pdf
 */

import { createLogger } from '@railrepay/winston-logger';
import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { callOcrService } from '../services/ocr-client.service.js';

const SUPPORTED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
]);

const TICKET_OR_MANUAL_PROMPT =
  'Send a photo of your ticket to get started quickly, or type MANUAL to enter your journey details.';

const MANUAL_PROMPT =
  "When did you travel? (when was your journey?)\n\nYou can say:\n• \"today\"\n• \"yesterday\"\n• \"15 Nov\"\n• \"15/11/2024\"\n\n(Claims must be made within 90 days of travel)";

/**
 * Handle AWAITING_TICKET_OR_MANUAL state
 *
 * AC-1: Send the ticket-or-manual branching prompt
 * AC-2: MANUAL keyword transitions to AWAITING_JOURNEY_DATE
 * AC-3: Media triggers synchronous OCR call
 * AC-22: OCR errors fall back gracefully to AWAITING_JOURNEY_DATE
 */
export async function ticketOrManualHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: process.env.SERVICE_NAME || 'whatsapp-handler' });
  const input = ctx.messageBody.trim().toUpperCase();
  const ocrBaseUrl = process.env.OCR_SERVICE_URL;

  // AC-2: MANUAL keyword — bypass OCR, go straight to manual date entry
  if (input === 'MANUAL') {
    return {
      response: MANUAL_PROMPT,
      nextState: FSMState.AWAITING_JOURNEY_DATE,
      stateData: {},
    };
  }

  // AC-3: Media attachment present — attempt OCR scan
  if (ctx.mediaUrl) {
    const contentType = ctx.mediaContentType as string | undefined;

    // Reject unsupported media types before calling OCR
    if (!contentType || !SUPPORTED_MEDIA_TYPES.has(contentType)) {
      return {
        response:
          "Sorry, I can only process photos (JPEG/PNG) or PDF files. Please send a photo of your ticket or type MANUAL to enter your journey details.",
        nextState: FSMState.AWAITING_TICKET_OR_MANUAL,
      };
    }

    try {
      const ocrPayload = {
        image_url: ctx.mediaUrl,
        user_id: ctx.user?.id ?? '',
        content_type: contentType as 'image/jpeg' | 'image/png' | 'application/pdf',
        correlation_id: ctx.correlationId,
      };

      const ocrResult = await callOcrService(ocrPayload, ocrBaseUrl);

      // Map OCR extracted_fields to standard stateData field names
      const ef = ocrResult.extracted_fields ?? {};
      const stateData: Record<string, any> = {
        scan_id: ocrResult.scan_id,
        ocr_confidence: ocrResult.confidence,
        claim_ready: ocrResult.claim_ready,
        image_gcs_path: ocrResult.image_gcs_path,
      };

      // Map non-null extracted fields to standard names
      if (ef.origin_crs != null) stateData.origin = ef.origin_crs;
      if (ef.destination_crs != null) stateData.destination = ef.destination_crs;
      if (ef.origin_station != null) stateData.originName = ef.origin_station;
      if (ef.destination_station != null) stateData.destinationName = ef.destination_station;
      if (ef.travel_date != null) stateData.travelDate = ef.travel_date;
      if (ef.departure_time != null) stateData.departureTime = ef.departure_time;
      if (ef.ticket_type != null) stateData.ticketType = ef.ticket_type;
      if (ef.ticket_class != null) stateData.ticketClass = ef.ticket_class;
      if (ef.fare_pence != null) stateData.farePence = ef.fare_pence;
      if (ef.operator_name != null) stateData.operatorName = ef.operator_name;

      return {
        response: "Got it! I've scanned your ticket. Please review the details and confirm.",
        nextState: FSMState.AWAITING_OCR_REVIEW,
        stateData,
      };
    } catch (error: any) {
      // AC-22: Graceful fallback — log warning, transition to manual flow
      logger.warn('OCR service unavailable, falling back to manual entry', {
        correlationId: ctx.correlationId,
        errorMessage: error?.message,
        statusCode: error?.response?.status,
        errorCode: error?.code,
      });

      return {
        response:
          "Sorry, I couldn't process your ticket photo right now. Please enter your journey details manually.",
        nextState: FSMState.AWAITING_JOURNEY_DATE,
        stateData: {},
      };
    }
  }

  // AC-1: No media and no MANUAL keyword — send prompt and stay in state
  return {
    response: TICKET_OR_MANUAL_PROMPT,
    nextState: FSMState.AWAITING_TICKET_OR_MANUAL,
  };
}
