/**
 * Journey Time Handler - Collect journey time and match routes
 *
 * SPEC: Day 5 § 2.7 Journey Time Handler
 * Per ADR-014: Implementation written AFTER tests
 *
 * WORKFLOW CHANGE: API call to journey-matcher happens HERE (after time provided),
 * not in journey-confirm.handler (after user says YES). This allows users to see
 * real matched routes BEFORE being asked to confirm.
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { parseTime } from '../utils/time-parser.js';
import { createLogger } from '@railrepay/winston-logger';
import axios from 'axios';

const logger = createLogger({ serviceName: 'whatsapp-handler' });

export async function journeyTimeHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const result = parseTime(ctx.messageBody);

  if (!result.success) {
    return {
      response: `${result.error}

Please try again with a valid time like:
• "14:30"
• "2:30pm"
• "1430"
• "2pm"`,
      nextState: FSMState.AWAITING_JOURNEY_TIME,
    };
  }

  const timeStr = `${result.hour.toString().padStart(2, '0')}:${result.minute.toString().padStart(2, '0')}`;

  // Get journey details from stateData (populated by previous handlers)
  const { origin, destination, travelDate, journeyId, originName, destinationName } = ctx.stateData || {};

  if (!origin || !destination || !travelDate) {
    logger.error('Missing journey details in stateData', {
      correlationId: ctx.correlationId,
      hasOrigin: !!origin,
      hasDestination: !!destination,
      hasTravelDate: !!travelDate,
    });
    return {
      response: 'Something went wrong. Please start again by telling me when you travelled.',
      nextState: FSMState.AWAITING_JOURNEY_DATE,
    };
  }

  // Get journey-matcher URL from environment
  const journeyMatcherUrl = process.env.JOURNEY_MATCHER_URL;
  if (!journeyMatcherUrl) {
    logger.error('JOURNEY_MATCHER_URL not configured', { correlationId: ctx.correlationId });
    return {
      response: 'Something went wrong. Please try again later.',
      nextState: FSMState.ERROR,
    };
  }

  try {
    // Call journey-matcher API to find real train segments
    logger.info('Calling journey-matcher API', {
      correlationId: ctx.correlationId,
      journeyId,
      origin,
      destination,
      date: travelDate,
      time: timeStr,
    });

    const apiResponse = await axios.get(`${journeyMatcherUrl}/routes`, {
      params: {
        from: origin,
        to: destination,
        date: travelDate,
        time: timeStr,
      },
      timeout: 30000, // 30s timeout for cold-start scenarios
      headers: {
        'X-Correlation-ID': ctx.correlationId,
      },
    });

    const routes = apiResponse.data.routes;

    if (!routes || routes.length === 0) {
      logger.warn('No routes found', {
        correlationId: ctx.correlationId,
        origin,
        destination,
        date: travelDate,
        time: timeStr,
      });
      return {
        response: `I couldn't find any trains matching that time. Please try a different time.`,
        nextState: FSMState.AWAITING_JOURNEY_TIME,
      };
    }

    const route = routes[0];
    const isDirect = route.isDirect !== undefined ? route.isDirect : route.legs.length === 1;
    const firstLeg = route.legs[0];

    // Use display names for user-facing messages
    const displayOrigin = originName || origin;
    const displayDestination = destinationName || destination;

    if (isDirect) {
      // Direct journey - single segment
      logger.info('Direct route found', {
        correlationId: ctx.correlationId,
        journeyId,
        departure: firstLeg.departure,
        operator: firstLeg.operator,
      });

      return {
        response: `I found the ${firstLeg.departure} ${displayOrigin} → ${displayDestination} (${firstLeg.operator}).

Is this the journey you took? Reply YES to confirm or NO to see alternatives.`,
        nextState: FSMState.AWAITING_JOURNEY_CONFIRM,
        stateData: {
          ...ctx.stateData,
          departureTime: timeStr,
          matchedRoute: route,
          isDirect: true,
        },
      };
    } else {
      // Interchange journey - multiple segments
      const interchangeStation = route.interchangeStation || route.legs[0].to;
      const legsSummary = route.legs
        .map((leg: any, i: number) => `  Leg ${i + 1}: ${leg.departure} ${leg.from} → ${leg.to}`)
        .join('\n');

      logger.info('Interchange route found', {
        correlationId: ctx.correlationId,
        journeyId,
        legCount: route.legs.length,
        interchangeStation,
      });

      return {
        response: `I found a journey with a change at ${interchangeStation}:

${legsSummary}

Is this the journey you took? Reply YES to confirm or NO to see alternatives.`,
        nextState: FSMState.AWAITING_JOURNEY_CONFIRM,
        stateData: {
          ...ctx.stateData,
          departureTime: timeStr,
          matchedRoute: route,
          isDirect: false,
          interchangeStation,
        },
      };
    }
  } catch (error: any) {
    logger.error('journey-matcher API error', {
      correlationId: ctx.correlationId,
      error: error.message,
      code: error.code,
    });

    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return {
        response: 'Route lookup is taking longer than expected. Please try again in a moment.',
        nextState: FSMState.AWAITING_JOURNEY_TIME,
      };
    }

    if (error.response?.status === 404) {
      return {
        response: `I couldn't find any trains for that route and time. Please check your stations and try again.`,
        nextState: FSMState.AWAITING_JOURNEY_TIME,
      };
    }

    return {
      response: 'Unable to find routes at this time. Please try again.',
      nextState: FSMState.AWAITING_JOURNEY_TIME,
    };
  }
}
