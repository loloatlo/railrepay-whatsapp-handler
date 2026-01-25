/**
 * Journey Stations Handler - Collect origin and destination stations
 *
 * SPEC: Day 5 § 2.6 Journey Stations Handler
 * Per ADR-014: Implementation written AFTER tests
 *
 * Now includes CRS code lookup via station.service for API compatibility
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { searchStations } from '../services/station.service.js';
import { getLogger } from '../lib/logger.js';

const logger = getLogger();

export async function journeyStationsHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const input = ctx.messageBody.trim();

  // Parse station format: "X to Y" or "from X to Y"
  const toPattern = /(?:from\s+)?(.+?)\s+to\s+(.+)/i;
  const match = input.match(toPattern);

  if (!match) {
    return {
      response: `Invalid format. Please tell me your journey like:

Examples:
• "Kings Cross to Edinburgh"
• "Manchester to London"
• "Brighton to Victoria"

Make sure to include "to" between the stations.`,
      nextState: FSMState.AWAITING_JOURNEY_STATIONS,
    };
  }

  const originName = match[1].trim();
  const destinationName = match[2].trim();

  // Validate both stations are non-empty
  if (!originName || !destinationName) {
    return {
      response: `Invalid format. Please provide both origin and destination stations.

Example: "Kings Cross to Edinburgh"`,
      nextState: FSMState.AWAITING_JOURNEY_STATIONS,
    };
  }

  // Look up CRS codes for station names via timetable-loader
  const originStations = await searchStations(originName);
  const destinationStations = await searchStations(destinationName);

  if (originStations.length === 0) {
    logger.warn('Station not found', { query: originName, correlationId: ctx.correlationId });
    return {
      response: `I couldn't find a station called "${originName}". Please try again with the full station name.`,
      nextState: FSMState.AWAITING_JOURNEY_STATIONS,
    };
  }

  if (destinationStations.length === 0) {
    logger.warn('Station not found', { query: destinationName, correlationId: ctx.correlationId });
    return {
      response: `I couldn't find a station called "${destinationName}". Please try again with the full station name.`,
      nextState: FSMState.AWAITING_JOURNEY_STATIONS,
    };
  }

  // Use first match (best match from timetable-loader)
  const originCRS = originStations[0].crs;
  const destinationCRS = destinationStations[0].crs;
  const resolvedOriginName = originStations[0].name;
  const resolvedDestinationName = destinationStations[0].name;

  logger.info('Stations resolved', {
    correlationId: ctx.correlationId,
    originName,
    originCRS,
    destinationName,
    destinationCRS,
  });

  return {
    response: `Got it! Journey route: ${resolvedOriginName} → ${resolvedDestinationName}

What time did your train depart?

You can say:
• "14:30"
• "2:30pm"
• "1430"
• "2pm"`,
    nextState: FSMState.AWAITING_JOURNEY_TIME,
    stateData: {
      ...ctx.stateData,
      origin: originCRS,              // CRS code for API calls
      destination: destinationCRS,    // CRS code for API calls
      originName: resolvedOriginName,       // Display name
      destinationName: resolvedDestinationName,  // Display name
    },
  };
}
