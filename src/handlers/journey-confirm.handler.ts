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
import { buildAlternativesResponse } from '../utils/buildAlternativesResponse.js';

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
    const { journeyId, allRoutes } = ctx.stateData || {};

    // AC-1: Check if only 1 route available
    if (!allRoutes || allRoutes.length <= 1) {
      logger.info('User rejected only available route', {
        correlationId: ctx.correlationId,
        journeyId,
      });

      return {
        response: `This appears to be the only available route for your journey at this time. You may want to try a different departure time.

Please reply with a different time (e.g., 14:30), or start over by sending a new date.`,
        nextState: FSMState.AWAITING_JOURNEY_CONFIRM, // Stay in same state
        stateData: ctx.stateData, // Preserve all fields
      };
    }

    // AC-2: Multi-route path — build Set 1 alternatives
    logger.info('User rejected matched route, showing alternatives from Set 1', {
      correlationId: ctx.correlationId,
      journeyId,
      allRoutesCount: allRoutes.length,
    });

    // Skip index 0 (the suggested route user rejected), show indices 1-3
    const alternativesSet1 = allRoutes.slice(1, 4);

    const response = buildAlternativesResponse(alternativesSet1);

    return {
      response,
      nextState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
      stateData: {
        ...ctx.stateData,
        currentAlternatives: alternativesSet1,
        alternativeCount: 1,
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
