/**
 * Claim Status Handler - Stub for AWAITING_CLAIM_STATUS dead FSM state
 *
 * BL-152: AWAITING_CLAIM_STATUS dead FSM state
 * Per ADR-014: Implementation written AFTER tests
 * Per ADR-002: Correlation IDs included in all logs
 *
 * DESIGN:
 * - Stub handler for FSMState.AWAITING_CLAIM_STATUS
 * - Feature is not yet available; returns a user-friendly "coming soon" message
 * - Transitions immediately back to AUTHENTICATED to prevent the dead-state trap
 * - Does NOT publish events (stub has no side effects)
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { createLogger } from '@railrepay/winston-logger';

export async function claimStatusHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: 'whatsapp-handler' });

  logger.info('AWAITING_CLAIM_STATUS state reached, claim status not yet available', {
    correlationId: ctx.correlationId,
    phoneNumber: ctx.phoneNumber,
    userId: ctx.user?.id,
  });

  return {
    response: `Claim status checking is not yet available. We're working on this feature and it will be available soon!\n\nType MENU to return to the main menu or DELAY to start a new claim.`,
    nextState: FSMState.AUTHENTICATED,
  };
}
