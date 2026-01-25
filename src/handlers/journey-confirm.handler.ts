/**
 * Journey Confirm Handler - Confirm journey details
 *
 * SPEC: Day 5 § 2.8 Journey Confirm Handler
 * Per ADR-014: Implementation written AFTER tests
 * TD-WHATSAPP-040: Inline routing check (Option C) - call journey-matcher API directly
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { createLogger } from '@railrepay/winston-logger';
import axios from 'axios';

export async function journeyConfirmHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: 'whatsapp-handler' });
  const input = ctx.messageBody.trim().toUpperCase();

  if (input === 'YES') {
    // TD-WHATSAPP-040: Call journey-matcher API to check if route requires interchange
    const journeyMatcherUrl = process.env.JOURNEY_MATCHER_URL;
    if (!journeyMatcherUrl) {
      logger.error('JOURNEY_MATCHER_URL not configured', {
        correlationId: ctx.correlationId,
      });
      return {
        response: 'Something went wrong. Please try again.',
        nextState: FSMState.ERROR,
      };
    }

    const { journeyId, origin, destination, travelDate, departureTime } = ctx.stateData || {};

    if (!journeyId || !origin || !destination || !travelDate || !departureTime) {
      logger.error('Missing journey details in stateData', {
        correlationId: ctx.correlationId,
        missingFields: {
          journeyId: !journeyId,
          origin: !origin,
          destination: !destination,
          travelDate: !travelDate,
          departureTime: !departureTime,
        },
      });
      return {
        response: 'Something went wrong. Please try again.',
        nextState: FSMState.ERROR,
      };
    }

    try {
      // Call journey-matcher API
      const apiUrl = `${journeyMatcherUrl}/routes`;
      logger.info('Calling journey-matcher API for routing check', {
        correlationId: ctx.correlationId,
        journeyId,
        origin,
        destination,
      });

      const apiResponse = await axios.get(apiUrl, {
        params: {
          from: origin,
          to: destination,
          date: travelDate,
          time: departureTime,
        },
        timeout: 15000, // TD-WHATSAPP-039: Timeout required
        headers: {
          'X-Correlation-ID': ctx.correlationId,
        },
      });

      const routes = apiResponse.data.routes;
      if (!routes || routes.length === 0) {
        logger.warn('No routes found', {
          correlationId: ctx.correlationId,
          journeyId,
        });
        return {
          response: 'We are unable to verify your journey routing. Please try again.',
          nextState: FSMState.AWAITING_JOURNEY_CONFIRM,
        };
      }

      const route = routes[0];

      // Check if route is direct or requires interchange
      if (route.isDirect) {
        // Direct route: skip routing confirmation, go straight to ticket upload
        logger.info('Direct route confirmed', {
          correlationId: ctx.correlationId,
          journeyId,
          isDirect: true,
        });

        return {
          response: `Great! Your journey is a direct route. Now please upload your ticket.`,
          nextState: FSMState.AWAITING_TICKET_UPLOAD,
          stateData: {
            ...ctx.stateData,
            confirmedRoute: route,
          },
        };
      } else {
        // Interchange route: present routing details and ask for confirmation
        logger.info('Interchange route detected', {
          correlationId: ctx.correlationId,
          journeyId,
          isDirect: false,
          interchangeStation: route.interchangeStation,
        });

        return {
          response: `Your journey requires an interchange (change) at ${route.interchangeStation}. Is this correct? Reply YES or NO.`,
          nextState: FSMState.AWAITING_ROUTING_CONFIRM,
          stateData: {
            ...ctx.stateData,
            suggestedRoute: route,
          },
        };
      }
    } catch (error: any) {
      // Error handling
      logger.error('journey-matcher API error', {
        correlationId: ctx.correlationId,
        journeyId,
        error: error.message || error.code,
      });

      return {
        response: 'We are unable to verify your journey routing. Please try again.',
        nextState: FSMState.AWAITING_JOURNEY_CONFIRM,
      };
    }
  }

  if (input === 'NO') {
    return {
      response: `No problem! Let's start over.

When did you travel? (when was your journey?)

You can say:
• "today"
• "yesterday"
• "15 Nov"
• "15/11/2024"`,
      nextState: FSMState.AWAITING_JOURNEY_DATE,
      stateData: {
        journeyCleared: true,
      },
    };
  }

  return {
    response: `Please reply YES to confirm your journey details, or NO to start over.`,
    nextState: FSMState.AWAITING_JOURNEY_CONFIRM,
  };
}
