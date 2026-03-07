/**
 * Ticket Price Handler - Collect ticket price in pence (manual ticket flow)
 *
 * TD-WHATSAPP-058: AC-3, AC-4, AC-9, AC-10, AC-11
 * Per ADR-014: Implementation written AFTER tests
 * Per ADR-002: Winston logger used for all logging
 *
 * TRIGGER: AWAITING_TICKET_PRICE state (user said SKIP at ticket-upload)
 * SUCCESS PATH: Store ticket_fare_pence in stateData, transition to AWAITING_TICKET_CLASS
 * SKIP PATH: Submit journey without ticket data (fallback), transition to AUTHENTICATED
 * ERROR PATH: Return error message, remain in AWAITING_TICKET_PRICE
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { createJourneyAndRespond } from './ticket-upload.handler.js';
import { createLogger } from '@railrepay/winston-logger';

export async function ticketPriceHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: 'whatsapp-handler' });
  const input = ctx.messageBody.trim();

  logger.info('ticket-price.handler: processing input', {
    correlationId: ctx.correlationId,
    phoneNumber: ctx.phoneNumber,
    inputLength: input.length,
  });

  // AC-10: SKIP at price prompt — submit journey without ticket data (fallback)
  if (input.toUpperCase() === 'SKIP') {
    logger.info('ticket-price.handler: SKIP received, submitting journey without ticket data', {
      correlationId: ctx.correlationId,
    });
    return createJourneyAndRespond(ctx, null);
  }

  // Parse price input: strip optional £ symbol, parse as float
  const stripped = input.replace(/^£/, '');

  // Validate: must be a non-empty numeric value (no letters, no double negatives)
  if (stripped === '' || stripped.trim() === '') {
    return buildErrorResult(ctx);
  }

  const parsed = parseFloat(stripped);

  // Validate: must be a valid finite number and non-negative
  if (isNaN(parsed) || !isFinite(parsed) || parsed < 0) {
    return buildErrorResult(ctx);
  }

  // Additional guard: the stripped string must only contain digits, dot, and optionally a leading minus
  // This rejects inputs like "45abc" which parseFloat would partially accept
  if (!/^\d+(\.\d+)?$/.test(stripped)) {
    return buildErrorResult(ctx);
  }

  // Convert to integer pence (round to avoid floating-point drift)
  const pence = Math.round(parsed * 100);

  logger.info('ticket-price.handler: valid price parsed', {
    correlationId: ctx.correlationId,
    pence,
  });

  // AC-9: Merge ticket_fare_pence into stateData (preserve existing journey data)
  const updatedStateData = {
    ...(ctx.stateData || {}),
    ticket_fare_pence: pence,
  };

  return {
    response: `Was this a Standard or First Class ticket?`,
    nextState: FSMState.AWAITING_TICKET_CLASS,
    stateData: updatedStateData,
  };
}

function buildErrorResult(ctx: HandlerContext): HandlerResult {
  return {
    response: `Sorry, I couldn't understand that price. Please enter the amount you paid, e.g. £45.50`,
    nextState: FSMState.AWAITING_TICKET_PRICE,
    stateData: ctx.stateData,
  };
}
