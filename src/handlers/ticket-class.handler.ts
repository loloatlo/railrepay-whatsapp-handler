/**
 * Ticket Class Handler - Collect ticket class (Standard/First) in manual ticket flow
 *
 * TD-WHATSAPP-058: AC-5, AC-6, AC-9, AC-12
 * Per ADR-014: Implementation written AFTER tests
 * Per ADR-002: Winston logger used for all logging
 *
 * TRIGGER: AWAITING_TICKET_CLASS state (after valid price entered)
 * SUCCESS PATH: Store ticket_class in stateData (lowercased), transition to AWAITING_TICKET_TYPE
 * ERROR PATH: Return error message, remain in AWAITING_TICKET_CLASS
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { createLogger } from '@railrepay/winston-logger';

const VALID_CLASSES = ['standard', 'first'] as const;
type TicketClass = typeof VALID_CLASSES[number];

export async function ticketClassHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: 'whatsapp-handler' });
  const input = ctx.messageBody.trim().toLowerCase();

  logger.info('ticket-class.handler: processing input', {
    correlationId: ctx.correlationId,
    phoneNumber: ctx.phoneNumber,
  });

  // AC-5: Validate input — must be STANDARD or FIRST (case-insensitive)
  if (!VALID_CLASSES.includes(input as TicketClass)) {
    logger.info('ticket-class.handler: invalid class input', {
      correlationId: ctx.correlationId,
      input,
    });
    return {
      response: `Sorry, I didn't recognise that. Please reply STANDARD or FIRST`,
      nextState: FSMState.AWAITING_TICKET_CLASS,
      stateData: ctx.stateData,
    };
  }

  const ticketClass = input as TicketClass;

  logger.info('ticket-class.handler: valid class received', {
    correlationId: ctx.correlationId,
    ticketClass,
  });

  // AC-9: Merge ticket_class into stateData (preserve existing journey data and ticket_fare_pence)
  const updatedStateData = {
    ...(ctx.stateData || {}),
    ticket_class: ticketClass,
  };

  return {
    response: `What type of ticket did you buy? Reply: ADVANCE, ANYTIME, OFF-PEAK, or SUPER OFF-PEAK`,
    nextState: FSMState.AWAITING_TICKET_TYPE,
    stateData: updatedStateData,
  };
}
