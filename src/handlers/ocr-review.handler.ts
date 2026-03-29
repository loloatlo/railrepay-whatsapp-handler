/**
 * OCR Review Handler — AWAITING_OCR_REVIEW state
 *
 * BL-167: TD-WHATSAPP-062-S1 — Core FSM + OCR Call + User Confirmation
 * Per ADR-002: Structured logging with correlation IDs
 *
 * BEHAVIOR:
 * - No input / unrecognised text → re-display summary, stay in AWAITING_OCR_REVIEW
 * - "YES" → keep OCR-extracted stateData, transition to AWAITING_JOURNEY_DATE
 * - "NO"  → discard OCR stateData (clean), transition to AWAITING_JOURNEY_DATE
 *
 * AC-10: Present extracted details in a readable summary asking YES/NO
 * AC-11: YES carries forward OCR fields into stateData for downstream handlers
 * AC-12: NO produces clean stateData (no OCR fields retained)
 */

import { createLogger } from '@railrepay/winston-logger';
import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';

/**
 * Build a human-readable summary of the OCR-extracted fields.
 * Omits any null/undefined fields so they never appear as "null" or "undefined".
 */
function buildOcrSummary(stateData: Record<string, any>): string {
  const lines: string[] = ["Here's what I found on your ticket:"];

  if (stateData.originName) lines.push(`• From: ${stateData.originName}`);
  else if (stateData.origin) lines.push(`• From: ${stateData.origin}`);

  if (stateData.destinationName) lines.push(`• To: ${stateData.destinationName}`);
  else if (stateData.destination) lines.push(`• To: ${stateData.destination}`);

  if (stateData.travelDate) lines.push(`• Date: ${stateData.travelDate}`);
  if (stateData.departureTime) lines.push(`• Time: ${stateData.departureTime}`);
  if (stateData.ticketType) lines.push(`• Ticket: ${stateData.ticketType}`);
  if (stateData.ticketClass) lines.push(`• Class: ${stateData.ticketClass}`);

  lines.push('');
  lines.push('Is this correct? Reply YES to confirm or NO to enter details manually.');

  return lines.join('\n');
}

/**
 * Handle AWAITING_OCR_REVIEW state
 *
 * AC-10: Show OCR extraction summary with YES/NO prompt
 * AC-11: YES → transition to AWAITING_JOURNEY_DATE with pre-filled stateData
 * AC-12: NO  → transition to AWAITING_JOURNEY_DATE with clean stateData
 */
export async function ocrReviewHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: process.env.SERVICE_NAME || 'whatsapp-handler' });
  const input = ctx.messageBody.trim().toUpperCase();
  const stateData = ctx.stateData ?? {};

  logger.info('OCR review handler invoked', {
    correlationId: ctx.correlationId,
    input,
  });

  // AC-11: User confirms OCR data — carry all OCR fields forward
  if (input === 'YES') {
    return {
      response: "Great! I'll use the details from your ticket. Please confirm your journey date to continue.",
      nextState: FSMState.AWAITING_JOURNEY_DATE,
      stateData: { ...stateData },
    };
  }

  // AC-12: User rejects OCR data — discard and start manual flow
  if (input === 'NO') {
    return {
      response:
        "No problem! Please enter your journey details manually. When did you travel?",
      nextState: FSMState.AWAITING_JOURNEY_DATE,
      stateData: {},
    };
  }

  // AC-10: No or unrecognised input — present summary and ask for YES/NO
  const summary = buildOcrSummary(stateData);

  return {
    response: summary,
    nextState: FSMState.AWAITING_OCR_REVIEW,
    stateData: { ...stateData },
  };
}
