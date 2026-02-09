/**
 * Routing Alternative Handler - Handle alternative routing selection
 *
 * USER STORY: Submitting a Journey to RailRepay
 * ACCEPTANCE CRITERIA: AC-3
 *
 * AC-3: If the suggestion is incorrect, receive up to 3 alternative suggested
 *       routings until I confirm the correct routing
 *
 * TD-WHATSAPP-054: Remove hardcoded mocks
 * - AC-1: Use stateData routes (Set 1) and journey-matcher API (Set 2+)
 * - AC-3: Reachable from AWAITING_ROUTING_CONFIRM
 * - AC-4: Store full route object in stateData.confirmedRoute
 * - AC-5: After 3 sets, transition to ERROR with escalation event
 *
 * Per ADR-014: Implementation written AFTER tests
 * Per ADR-002: Correlation IDs included in all logs
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { createLogger } from '@railrepay/winston-logger';
import axios from 'axios';

export async function routingAlternativeHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: 'whatsapp-handler' });
  const input = ctx.messageBody.trim().toUpperCase();

  // Check if we're entering the alternative state (coming from AWAITING_ROUTING_CONFIRM or AWAITING_JOURNEY_CONFIRM)
  if ((ctx.currentState === FSMState.AWAITING_ROUTING_CONFIRM || ctx.currentState === FSMState.AWAITING_JOURNEY_CONFIRM) && input === 'NO') {
    // Set 1: Display alternatives from stateData.allRoutes (populated by journey-time.handler)
    const allRoutes = ctx.stateData?.allRoutes || [];

    // Skip index 0 (the suggested route that was rejected), show indices 1, 2, 3
    const alternativesFromState = allRoutes.slice(1, 4);

    if (alternativesFromState.length > 0) {
      // We have alternatives from the original API call
      logger.info('Presenting alternative routes from stateData', {
        correlationId: ctx.correlationId,
        alternativeCount: alternativesFromState.length,
      });

      const response = buildAlternativesResponse(alternativesFromState);

      return {
        response,
        nextState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
        stateData: {
          ...ctx.stateData,
          currentAlternatives: alternativesFromState,
          alternativeCount: 1,
        },
      };
    } else {
      // No alternatives in stateData - fall back to journey-matcher API
      logger.info('No alternatives in stateData, calling journey-matcher API', {
        correlationId: ctx.correlationId,
      });

      return await fetchAndDisplayAlternatives(ctx, logger, 1);
    }
  }

  // Handle user selection in AWAITING_ROUTING_ALTERNATIVE state
  if (ctx.currentState === FSMState.AWAITING_ROUTING_ALTERNATIVE) {
    // Check for numbered selection (1, 2, or 3)
    if (input === '1' || input === '2' || input === '3') {
      const selectedNumber = parseInt(input, 10);
      const currentAlternatives = ctx.stateData?.currentAlternatives || [];

      if (selectedNumber > currentAlternatives.length) {
        return {
          response: `Please select a valid option (1-${currentAlternatives.length}).`,
          nextState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
          stateData: ctx.stateData,
        };
      }

      // Get the full route object (0-indexed, so subtract 1)
      const selectedRoute = currentAlternatives[selectedNumber - 1];

      logger.info('User selected alternative route', {
        correlationId: ctx.correlationId,
        selectedAlternative: selectedNumber,
      });

      return {
        response: `Great! You've selected route ${selectedNumber}.

Now please send a photo of your ticket.

You can:
• Take a photo of your physical ticket
• Screenshot your e-ticket
• Upload your ticket PDF

Or reply SKIP to submit without a ticket (for MVP testing).`,
        nextState: FSMState.AWAITING_TICKET_UPLOAD,
        stateData: {
          ...ctx.stateData,
          confirmedRoute: selectedRoute,
          routingConfirmed: true,
        },
      };
    }

    // Check for NONE (user rejects all alternatives)
    if (input === 'NONE') {
      const currentAlternativeCount = ctx.stateData?.alternativeCount || 1;

      if (currentAlternativeCount >= 3) {
        // Max alternatives exceeded - escalate
        logger.warn('Max routing alternatives exceeded', {
          correlationId: ctx.correlationId,
          alternativeCount: currentAlternativeCount,
        });

        const journeyId = ctx.stateData?.journeyId || 'unknown';

        return {
          response: `I'm unable to find a matching route from the available options. Let me escalate this to our support team for manual verification.

We'll be in touch within 24 hours.`,
          nextState: FSMState.ERROR,
          stateData: {
            ...ctx.stateData,
            escalationRequired: true,
          },
          publishEvents: [
            {
              id: '', // Will be generated by repository
              aggregate_id: journeyId,
              aggregate_type: 'journey',
              event_type: 'journey.routing_escalation',
              payload: {
                journeyId,
                userId: ctx.user?.id,
                reason: 'max_alternatives_exceeded',
                alternativeCount: currentAlternativeCount,
              },
              published_at: null,
              created_at: new Date(),
            },
          ],
        };
      }

      // Show next set of alternatives (Set 2+)
      logger.info('User requested more alternatives', {
        correlationId: ctx.correlationId,
        alternativeCount: currentAlternativeCount,
      });

      return await fetchAndDisplayAlternatives(ctx, logger, currentAlternativeCount);
    }

    // Invalid input
    return {
      response: `Please reply with 1, 2, or 3 to select a route, or NONE to see more options.`,
      nextState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
      stateData: ctx.stateData,
    };
  }

  // Shouldn't reach here, but handle gracefully
  return {
    response: `Something went wrong. Please try again.`,
    nextState: FSMState.ERROR,
  };
}

/**
 * Fetch alternatives from journey-matcher API and display them
 */
async function fetchAndDisplayAlternatives(
  ctx: HandlerContext,
  logger: any,
  alternativeCount: number
): Promise<HandlerResult> {
  const { origin, destination, travelDate, departureTime } = ctx.stateData || {};

  if (!origin || !destination || !travelDate || !departureTime) {
    logger.error('Missing journey details for API call', {
      correlationId: ctx.correlationId,
    });
    return {
      response: 'Something went wrong. Please start again.',
      nextState: FSMState.ERROR,
    };
  }

  const journeyMatcherUrl = process.env.JOURNEY_MATCHER_URL;
  if (!journeyMatcherUrl) {
    logger.error('JOURNEY_MATCHER_URL not configured', { correlationId: ctx.correlationId });
    return {
      response: 'Something went wrong. Please try again later.',
      nextState: FSMState.ERROR,
    };
  }

  try {
    // Calculate offset: skip (alternativeCount * 3) routes
    const offset = alternativeCount * 3;

    logger.info('Calling journey-matcher API for alternatives', {
      correlationId: ctx.correlationId,
      origin,
      destination,
      date: travelDate,
      time: departureTime,
      offset,
    });

    const apiResponse = await axios.get(`${journeyMatcherUrl}/routes`, {
      params: {
        from: origin,
        to: destination,
        date: travelDate,
        time: departureTime,
        offset,
      },
      timeout: 15000, // TD-WHATSAPP-039: 15 second timeout
      headers: {
        'X-Correlation-ID': ctx.correlationId,
      },
    });

    const routes = apiResponse.data.routes;

    if (!routes || routes.length === 0) {
      logger.warn('No routes found', {
        correlationId: ctx.correlationId,
        offset,
      });
      return {
        response: `I couldn't find any more alternative routes. Please try a different journey.`,
        nextState: FSMState.ERROR,
      };
    }

    // Display up to 3 routes
    const alternativesToDisplay = routes.slice(0, 3);
    const response = buildAlternativesResponse(alternativesToDisplay);

    return {
      response,
      nextState: FSMState.AWAITING_ROUTING_ALTERNATIVE,
      stateData: {
        ...ctx.stateData,
        currentAlternatives: alternativesToDisplay,
        alternativeCount: alternativeCount + 1,
      },
    };
  } catch (error: any) {
    logger.error('journey-matcher API error', {
      correlationId: ctx.correlationId,
      error: error.message,
      code: error.code,
    });

    return {
      response: 'Unable to fetch alternative routes at this time. Please try again.',
      nextState: FSMState.ERROR,
    };
  }
}

/**
 * Build response message from route alternatives
 */
function buildAlternativesResponse(routes: any[]): string {
  let response = `Here are alternative routes for your journey:\n`;

  routes.forEach((route, index) => {
    const optionNumber = index + 1;
    const legs = route.legs || [];

    // Build route summary
    const stationPath = legs.map((leg: any) => leg.from).concat(legs[legs.length - 1]?.to || []).join(' → ');

    response += `\n${optionNumber}. ${stationPath}\n`;

    // Add leg details
    legs.forEach((leg: any, legIndex: number) => {
      response += `   Leg ${legIndex + 1}: ${leg.from} → ${leg.to} (${leg.operator}, ${leg.departure}-${leg.arrival})\n`;
    });

    response += `   Total: ${route.totalDuration}\n`;
  });

  response += `\nReply with 1, 2, or 3 to select a route, or NONE if none of these match your journey.`;

  return response;
}
