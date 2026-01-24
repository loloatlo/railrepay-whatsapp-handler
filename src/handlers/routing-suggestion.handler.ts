/**
 * Routing Suggestion Handler - Handle routing confirmation for journeys with interchanges
 *
 * USER STORY: Submitting a Journey to RailRepay
 * ACCEPTANCE CRITERIA: AC-2 (partial AC-3)
 *
 * AC-2: If my journey required me to change stations, receive a message with the
 *       suggested routing for me to confirm is correct
 *
 * Per ADR-014: Implementation written AFTER tests
 * Per ADR-002: Correlation IDs included in all logs
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { createLogger } from '@railrepay/winston-logger';

export async function routingSuggestionHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: 'whatsapp-handler' });
  const input = ctx.messageBody.trim().toUpperCase();

  // Check if we're entering the routing confirmation state (coming from AWAITING_JOURNEY_TIME)
  if (ctx.currentState === FSMState.AWAITING_JOURNEY_TIME) {
    // Mock journey data - in real implementation, this would come from journey-matcher API
    const journeyId = 'journey-456';
    const suggestedRoute = {
      legs: [
        { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
        { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '11:45', arrival: '12:15' },
      ],
      totalDuration: '2h 15m',
    };

    logger.info('Routing confirmation required', {
      correlationId: ctx.correlationId,
      journeyId,
      interchangeRequired: true,
    });

    const response = `Your journey requires a change at the following stations:

Leg 1: PAD → BRI
Departs: 10:00, Arrives: 11:30
Operator: GWR

Leg 2: BRI → CDF
Departs: 11:45, Arrives: 12:15
Operator: GWR

Total Duration: 2h 15m

Is this routing correct? Reply YES to confirm, or NO to see alternative routes.`;

    return {
      response,
      nextState: FSMState.AWAITING_ROUTING_CONFIRM,
      stateData: {
        journeyId,
        suggestedRoute,
      },
    };
  }

  // Handle user response to routing confirmation
  if (ctx.currentState === FSMState.AWAITING_ROUTING_CONFIRM) {
    if (input === 'YES') {
      logger.info('User confirmed routing', {
        correlationId: ctx.correlationId,
        selectedRoute: 'suggested',
      });

      return {
        response: `Perfect! Your routing has been confirmed.

Now please send a photo of your ticket.

You can:
• Take a photo of your physical ticket
• Screenshot your e-ticket
• Upload your ticket PDF

Or reply SKIP to submit without a ticket (for MVP testing).`,
        nextState: FSMState.AWAITING_TICKET_UPLOAD,
        stateData: {
          routingConfirmed: true,
        },
      };
    }

    if (input === 'NO') {
      logger.info('User rejected routing suggestion', {
        correlationId: ctx.correlationId,
      });

      return {
        response: `Let me show you some alternative routes.`,
        nextState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
        stateData: {
          alternativeCount: 1,
        },
      };
    }

    // Invalid input
    return {
      response: `Please reply YES to confirm this routing, or NO to see alternative routes.`,
      nextState: FSMState.AWAITING_ROUTING_CONFIRM,
    };
  }

  // Shouldn't reach here, but handle gracefully
  return {
    response: `Something went wrong. Please try again.`,
    nextState: FSMState.ERROR,
  };
}
