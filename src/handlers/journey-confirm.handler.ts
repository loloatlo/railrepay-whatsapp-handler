/**
 * Journey Confirm Handler - Confirm journey details
 *
 * SPEC: Day 5 § 2.8 Journey Confirm Handler
 * Per ADR-014: Implementation written AFTER tests
 *
 * SIMPLIFIED: API call moved to journey-time.handler. This handler now only
 * handles YES/NO confirmation responses. Users have already seen the matched
 * route from journey-time.handler before reaching this state.
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { createLogger } from '@railrepay/winston-logger';

const logger = createLogger({ serviceName: 'whatsapp-handler' });

export async function journeyConfirmHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const input = ctx.messageBody.trim().toUpperCase();

  if (input === 'YES') {
    // Route already matched in journey-time.handler
    const { matchedRoute, journeyId, isDirect } = ctx.stateData || {};

    if (!matchedRoute) {
      logger.error('Missing matchedRoute in stateData', {
        correlationId: ctx.correlationId,
        journeyId,
      });
      return {
        response: 'Something went wrong. Please start again.',
        nextState: FSMState.AWAITING_JOURNEY_DATE,
      };
    }

    logger.info('Journey confirmed by user', {
      correlationId: ctx.correlationId,
      journeyId,
      isDirect,
      legCount: matchedRoute.legs?.length,
    });

    return {
      response: `Great! Your journey is confirmed.

Now please upload a photo of your ticket.`,
      nextState: FSMState.AWAITING_TICKET_UPLOAD,
      stateData: {
        ...ctx.stateData,
        confirmedRoute: matchedRoute,
        journeyConfirmed: true,
      },
    };
  }

  if (input === 'NO') {
    const { journeyId } = ctx.stateData || {};

    logger.info('User rejected matched route', {
      correlationId: ctx.correlationId,
      journeyId,
    });

    // User rejected - show alternative routes
    return {
      response: `No problem! Let me find some alternative routes for you.`,
      nextState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
      stateData: {
        ...ctx.stateData,
        needsAlternatives: true,
      },
    };
  }

  // Invalid input - prompt again
  return {
    response: `Please reply YES to confirm your journey, or NO to see alternatives.`,
    nextState: FSMState.AWAITING_JOURNEY_CONFIRM,
  };
}
