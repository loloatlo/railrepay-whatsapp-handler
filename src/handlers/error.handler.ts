/**
 * Error Handler - Generic error recovery
 *
 * TD-WHATSAPP-054: AC-5
 * Per ADR-014: Implementation written AFTER tests
 * Per ADR-002: Correlation IDs included in all logs
 *
 * DESIGN:
 * - Generic handler for FSMState.ERROR
 * - Sends user-friendly apology message
 * - Transitions to AUTHENTICATED state (recovery)
 * - Does NOT publish events (calling handler publishes before transitioning to ERROR)
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { createLogger } from '@railrepay/winston-logger';

export async function errorHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: 'whatsapp-handler' });

  logger.info('ERROR state reached, recovering to AUTHENTICATED', {
    correlationId: ctx.correlationId,
    phoneNumber: ctx.phoneNumber,
    userId: ctx.user?.id,
  });

  return {
    response: `Sorry, we couldn't find a suitable route for your journey. We've escalated this to our support team who will review your case within 24 hours. In the meantime, type MENU to start a new claim or CHECK to view an existing one.`,
    nextState: FSMState.AUTHENTICATED,
  };
}
