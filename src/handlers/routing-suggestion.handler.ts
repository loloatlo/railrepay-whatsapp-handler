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
 * Per TD-WHATSAPP-028: Journey-matcher API integration (real HTTP client)
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { createLogger } from '@railrepay/winston-logger';
import axios from 'axios';

export async function routingSuggestionHandler(ctx: HandlerContext): Promise<HandlerResult> {
  // Create logger instance per invocation for testability
  // In tests, the mock will return the same instance that the test can access
  const logger = createLogger({ serviceName: 'whatsapp-handler' });
  const input = ctx.messageBody.trim().toUpperCase();

  // Check if we're entering the routing confirmation state (coming from AWAITING_JOURNEY_TIME)
  if (ctx.currentState === FSMState.AWAITING_JOURNEY_TIME) {
    // Validate JOURNEY_MATCHER_URL is configured (AC-4)
    const journeyMatcherUrl = process.env.JOURNEY_MATCHER_URL;
    if (!journeyMatcherUrl) {
      throw new Error('JOURNEY_MATCHER_URL environment variable is not configured');
    }

    // Extract journeyId from FSM state data (AC-1)
    const journeyId = ctx.stateData?.journeyId;
    if (!journeyId) {
      logger.error('Missing journeyId in state data', {
        correlationId: ctx.correlationId,
      });
      return {
        response: 'Something went wrong. Please try again.',
        nextState: FSMState.ERROR,
      };
    }

    try {
      // Make HTTP call to journey-matcher API (AC-1, AC-5)
      const apiUrl = `${journeyMatcherUrl}/journeys/${journeyId}/routes`;
      logger.info('Fetching routes from journey-matcher', {
        correlationId: ctx.correlationId,
        journeyId,
        apiUrl,
      });

      const apiResponse = await axios.get(apiUrl, {
        headers: {
          'X-Correlation-ID': ctx.correlationId, // AC-5: Correlation ID propagation
        },
      });

      // Parse API response (AC-2)
      const routes = apiResponse.data.routes;
      if (!routes || routes.length === 0) {
        logger.warn('No routes returned from journey-matcher', {
          correlationId: ctx.correlationId,
          journeyId,
        });
        return {
          response: 'We were unable to find any routes for your journey. Please try again.',
          nextState: FSMState.ERROR,
        };
      }

      // Use the first suggested route
      const suggestedRoute = routes[0];

      logger.info('Routing confirmation required', {
        correlationId: ctx.correlationId,
        journeyId,
        interchangeRequired: true,
        legsCount: suggestedRoute.legs.length,
      });

      // Build response message dynamically from API data (AC-2)
      let responseText = 'Your journey requires a change at the following stations:\n';

      suggestedRoute.legs.forEach((leg: any, index: number) => {
        responseText += `\nLeg ${index + 1}: ${leg.from} → ${leg.to}\n`;
        responseText += `Departs: ${leg.departure}, Arrives: ${leg.arrival}\n`;
        responseText += `Operator: ${leg.operator}\n`;
      });

      responseText += `\nTotal Duration: ${suggestedRoute.totalDuration}\n`;
      responseText += `\nIs this routing correct? Reply YES to confirm, or NO to see alternative routes.`;

      return {
        response: responseText,
        nextState: FSMState.AWAITING_ROUTING_CONFIRM,
        stateData: {
          journeyId,
          suggestedRoute,
        },
      };
    } catch (error: any) {
      // Error handling (AC-3)
      logger.error('Journey-matcher API error', {
        correlationId: ctx.correlationId,
        journeyId,
        error: error.message,
        stack: error.stack,
      });

      // Handle different error scenarios (AC-3)
      // Check for HTTP response errors first
      if (error.response?.status === 404) {
        // Journey not found
        logger.error('Journey not found in journey-matcher', {
          correlationId: ctx.correlationId,
          journeyId,
          status: 404,
        });
        return {
          response: 'We were unable to find your journey. Please try again.',
          nextState: FSMState.ERROR,
        };
      }

      if (error.response?.status === 500) {
        // Internal server error
        logger.error('Journey-matcher internal server error', {
          correlationId: ctx.correlationId,
          journeyId,
          status: 500,
        });
        return {
          response: 'The journey routing service is temporarily unavailable. Please try again later.',
          nextState: FSMState.ERROR,
        };
      }

      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        // Timeout
        logger.error('Journey-matcher timeout', {
          correlationId: ctx.correlationId,
          journeyId,
          code: error.code,
        });
        return {
          response: 'The journey routing service is unavailable. Please try again later.',
          nextState: FSMState.ERROR,
        };
      }

      // Generic error logging
      logger.error('Journey-matcher error', {
        correlationId: ctx.correlationId,
        journeyId,
        status: error.response?.status,
        code: error.code,
        message: error.message,
      });

      // Generic error fallback
      return {
        response: 'The journey routing service is temporarily unavailable. Please try again later.',
        nextState: FSMState.ERROR,
      };
    }
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
