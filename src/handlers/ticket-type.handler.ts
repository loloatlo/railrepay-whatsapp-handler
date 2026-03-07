/**
 * Ticket Type Handler - Collect ticket type and submit journey (manual ticket flow)
 *
 * TD-WHATSAPP-058: AC-7, AC-8, AC-9, AC-13
 * Per ADR-014: Implementation written AFTER tests
 * Per ADR-002: Winston logger used for all logging
 *
 * TRIGGER: AWAITING_TICKET_TYPE state (after valid class entered)
 * SUCCESS PATH: Store ticket_type in stateData (lowercased), call createJourneyAndRespond
 *               with full ticket data → transitions to AUTHENTICATED
 * ERROR PATH: Return error message, remain in AWAITING_TICKET_TYPE
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { createJourneyAndRespond } from './ticket-upload.handler.js';
import { createLogger } from '@railrepay/winston-logger';

const VALID_TYPES = ['advance', 'anytime', 'off-peak', 'super off-peak'] as const;
type TicketType = typeof VALID_TYPES[number];

const ERROR_RESPONSE = `Sorry, I didn't recognise that ticket type. Please reply: ADVANCE, ANYTIME, OFF-PEAK, or SUPER OFF-PEAK`;

export async function ticketTypeHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: 'whatsapp-handler' });
  const input = ctx.messageBody.trim().toLowerCase();

  logger.info('ticket-type.handler: processing input', {
    correlationId: ctx.correlationId,
    phoneNumber: ctx.phoneNumber,
  });

  // AC-7: Validate input — must be one of the four valid ticket types (case-insensitive)
  if (!VALID_TYPES.includes(input as TicketType)) {
    logger.info('ticket-type.handler: invalid type input', {
      correlationId: ctx.correlationId,
      input,
    });
    return {
      response: ERROR_RESPONSE,
      nextState: FSMState.AWAITING_TICKET_TYPE,
      stateData: ctx.stateData,
    };
  }

  const ticketType = input as TicketType;

  logger.info('ticket-type.handler: valid type received, submitting journey', {
    correlationId: ctx.correlationId,
    ticketType,
  });

  // AC-9: Build context with ticket_type merged into stateData so createJourneyAndRespond
  //       picks it up and includes it (alongside ticket_fare_pence and ticket_class) in payload
  const enrichedCtx: HandlerContext = {
    ...ctx,
    stateData: {
      ...(ctx.stateData || {}),
      ticket_type: ticketType,
    },
  };

  // AC-8: Submit journey with all ticket data (ticket_fare_pence, ticket_class, ticket_type)
  return createJourneyAndRespond(enrichedCtx, null);
}
