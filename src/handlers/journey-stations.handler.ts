/**
 * Journey Stations Handler - Collect origin and destination stations
 *
 * SPEC: Day 5 § 2.6 Journey Stations Handler
 * Per ADR-014: Implementation written AFTER tests
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';

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

  const origin = match[1].trim();
  const destination = match[2].trim();

  // Validate both stations are non-empty
  if (!origin || !destination) {
    return {
      response: `Invalid format. Please provide both origin and destination stations.

Example: "Kings Cross to Edinburgh"`,
      nextState: FSMState.AWAITING_JOURNEY_STATIONS,
    };
  }

  // TODO: In production, validate stations with station service
  // For MVP, we accept any station names and store them

  return {
    response: `Got it! Journey route: ${origin} → ${destination}

What time did your train depart?

You can say:
• "14:30"
• "2:30pm"
• "1430"
• "2pm"`,
    nextState: FSMState.AWAITING_JOURNEY_TIME,
    stateData: {
      originStation: origin,
      destinationStation: destination,
    },
  };
}
