/**
 * OCR Review Handler — AWAITING_OCR_REVIEW state
 *
 * BL-167: TD-WHATSAPP-062-S1 — Core FSM + OCR Call + User Confirmation
 * BL-170: TD-WHATSAPP-062-S2 — Adaptive Extraction Routing
 * Per ADR-002: Structured logging with correlation IDs
 *
 * BEHAVIOR:
 * - No input / unrecognised text → re-display summary, stay in AWAITING_OCR_REVIEW
 * - "YES" → adaptive routing based on available OCR fields (AC-4 through AC-9)
 * - "NO"  → discard OCR stateData (clean), transition to AWAITING_JOURNEY_DATE
 *
 * AC-10: Present extracted details in a readable summary asking YES/NO
 * AC-12: NO produces clean stateData (no OCR fields retained)
 *
 * Adaptive YES routing (S2):
 * AC-4:  origin CRS + destination CRS + travelDate + departureTime → /routes → AWAITING_JOURNEY_CONFIRM
 * AC-5:  origin CRS + destination CRS + travelDate (no time) → AWAITING_JOURNEY_TIME
 * AC-6:  origin CRS + destination CRS (no date) → AWAITING_JOURNEY_DATE
 * AC-7:  travelDate only (no stations) → AWAITING_JOURNEY_STATIONS
 * AC-8:  station names without CRS → attempt CRS lookup, re-evaluate
 * AC-9:  no usable fields → AWAITING_JOURNEY_DATE with friendly fallback
 */

import { createLogger, type Logger } from '@railrepay/winston-logger';
import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { searchStations } from '../services/station.service.js';
import axios from 'axios';
import { getTocName } from '../utils/toc-names.js';

/**
 * Build a human-readable summary of the OCR-extracted fields.
 * Omits any null/undefined fields so they never appear as "null" or "undefined".
 */
function buildOcrSummary(stateData: Record<string, any>): string {
  const lines: string[] = ["Here's what I found on your ticket:"];

  if (stateData.originName) lines.push(`• From: ${stateData.originName}`);
  else if (stateData.origin) lines.push(`• From: ${stateData.origin}`);

  if (stateData.destinationName) lines.push(`• To: ${stateData.destinationName}`);
  else if (stateData.destination) lines.push(`• To: ${stateData.destination}`);

  if (stateData.travelDate) lines.push(`• Date: ${stateData.travelDate}`);
  if (stateData.departureTime) lines.push(`• Time: ${stateData.departureTime}`);
  if (stateData.ticketType) lines.push(`• Ticket: ${stateData.ticketType}`);
  if (stateData.ticketClass) lines.push(`• Class: ${stateData.ticketClass}`);

  lines.push('');
  lines.push('Is this correct? Reply YES to confirm or NO to enter details manually.');

  return lines.join('\n');
}

/**
 * Attempt to resolve CRS codes for station names present in stateData.
 * Returns enriched stateData with origin/destination set if lookup succeeded.
 */
async function resolveCrsCodes(
  stateData: Record<string, any>,
  logger: Logger,
  correlationId: string
): Promise<Record<string, any>> {
  const enriched = { ...stateData };

  const lookupOrigin = stateData.originName && !stateData.origin;
  const lookupDestination = stateData.destinationName && !stateData.destination;

  if (!lookupOrigin && !lookupDestination) {
    return enriched;
  }

  const lookups: Array<Promise<void>> = [];

  if (lookupOrigin) {
    lookups.push(
      searchStations(stateData.originName)
        .then((stations) => {
          if (stations.length > 0) {
            enriched.origin = stations[0].crs;
            logger.info('CRS resolved for origin', {
              correlationId,
              name: stateData.originName,
              crs: stations[0].crs,
            });
          }
        })
        .catch((err: any) => {
          logger.error('CRS lookup failed for origin', {
            correlationId,
            name: stateData.originName,
            error: err.message,
          });
        })
    );
  }

  if (lookupDestination) {
    lookups.push(
      searchStations(stateData.destinationName)
        .then((stations) => {
          if (stations.length > 0) {
            enriched.destination = stations[0].crs;
            logger.info('CRS resolved for destination', {
              correlationId,
              name: stateData.destinationName,
              crs: stations[0].crs,
            });
          }
        })
        .catch((err: any) => {
          logger.error('CRS lookup failed for destination', {
            correlationId,
            name: stateData.destinationName,
            error: err.message,
          });
        })
    );
  }

  await Promise.all(lookups);
  return enriched;
}

/**
 * Call journey-matcher /routes and return the matched route result.
 * Returns HandlerResult on success or error, or null if caller should handle differently.
 */
async function callRoutesMatcher(
  stateData: Record<string, any>,
  logger: Logger,
  correlationId: string,
  journeyMatcherUrl: string
): Promise<HandlerResult> {
  const { origin, destination, travelDate, departureTime, originName, destinationName } = stateData;

  logger.info('Calling journey-matcher API (AC-4 adaptive routing)', {
    correlationId,
    origin,
    destination,
    date: travelDate,
    time: departureTime,
  });

  try {
    const apiResponse = await axios.get(`${journeyMatcherUrl}/routes`, {
      params: {
        from: origin,
        to: destination,
        date: travelDate,
        time: departureTime,
      },
      timeout: 30000,
      headers: {
        'X-Correlation-ID': correlationId,
      },
    });

    const routes = apiResponse.data.routes;

    if (!routes || routes.length === 0) {
      logger.warn('No routes found in AC-4 adaptive routing', {
        correlationId,
        origin,
        destination,
        date: travelDate,
        time: departureTime,
      });
      return {
        response: `I couldn't find any trains matching that time. Please provide the departure time.`,
        nextState: FSMState.AWAITING_JOURNEY_TIME,
        stateData: { ...stateData },
      };
    }

    const route = routes[0];
    const isDirect = route.isDirect !== undefined ? route.isDirect : route.legs.length === 1;
    const firstLeg = route.legs[0];
    const displayOrigin = originName || origin;
    const displayDestination = destinationName || destination;

    if (isDirect) {
      const tocName = getTocName(firstLeg.operator);
      logger.info('Direct route found (AC-4)', {
        correlationId,
        departure: firstLeg.departure,
        operator: firstLeg.operator,
      });

      return {
        response: `I found the ${firstLeg.departure} ${tocName} ${displayOrigin} → ${displayDestination} service.

Is this the journey you took? Reply YES to confirm or NO to see alternatives.`,
        nextState: FSMState.AWAITING_JOURNEY_CONFIRM,
        stateData: {
          ...stateData,
          matchedRoute: route,
          allRoutes: routes,
          isDirect: true,
        },
      };
    } else {
      const interchangeStation = route.interchangeStation || route.legs[0].to;
      const legsSummary = route.legs
        .map((leg: any, i: number) => `  Leg ${i + 1}: ${leg.departure} ${leg.from} → ${leg.to}`)
        .join('\n');

      logger.info('Interchange route found (AC-4)', {
        correlationId,
        legCount: route.legs.length,
        interchangeStation,
      });

      return {
        response: `I found a journey with a change at ${interchangeStation}:

${legsSummary}

Is this the journey you took? Reply YES to confirm or NO to see alternatives.`,
        nextState: FSMState.AWAITING_JOURNEY_CONFIRM,
        stateData: {
          ...stateData,
          matchedRoute: route,
          allRoutes: routes,
          isDirect: false,
          interchangeStation,
        },
      };
    }
  } catch (error: any) {
    logger.error('journey-matcher API error in AC-4 adaptive routing', {
      correlationId,
      error: error.message,
      code: error.code,
    });

    return {
      response: 'I had trouble looking up your route. Please provide your departure time to continue.',
      nextState: FSMState.AWAITING_JOURNEY_TIME,
      stateData: { ...stateData },
    };
  }
}

/**
 * Adaptive routing decision tree for the YES branch.
 * Evaluates available fields in stateData and routes to the optimal next state.
 *
 * AC-4: origin + destination + travelDate + departureTime → /routes → AWAITING_JOURNEY_CONFIRM
 * AC-5: origin + destination + travelDate (no time) → AWAITING_JOURNEY_TIME
 * AC-6: origin + destination (no date) → AWAITING_JOURNEY_DATE
 * AC-7: travelDate only (no stations) → AWAITING_JOURNEY_STATIONS
 * AC-8: station names without CRS → lookup → re-evaluate
 * AC-9: no usable fields → AWAITING_JOURNEY_DATE (fallback)
 */
async function adaptiveRoute(
  stateData: Record<string, any>,
  logger: Logger,
  correlationId: string
): Promise<HandlerResult> {
  // AC-8: If station names present but CRS codes missing, attempt lookup first
  const hasOriginName = !!stateData.originName;
  const hasDestName = !!stateData.destinationName;
  const hasOriginCrs = !!stateData.origin;
  const hasDestCrs = !!stateData.destination;
  const needsCrsLookup = (hasOriginName && !hasOriginCrs) || (hasDestName && !hasDestCrs);

  let workingStateData = stateData;

  if (needsCrsLookup) {
    logger.info('AC-8: Attempting CRS code resolution from station names', {
      correlationId,
      originName: stateData.originName,
      destinationName: stateData.destinationName,
    });
    workingStateData = await resolveCrsCodes(stateData, logger, correlationId);
  }

  const origin = workingStateData.origin;
  const destination = workingStateData.destination;
  const travelDate = workingStateData.travelDate;
  const departureTime = workingStateData.departureTime;

  const hasStations = !!origin && !!destination;
  const hasDate = !!travelDate;
  const hasTime = !!departureTime;

  // AC-4: All four fields available → attempt route match
  if (hasStations && hasDate && hasTime) {
    const journeyMatcherUrl = process.env.JOURNEY_MATCHER_URL;
    if (!journeyMatcherUrl) {
      logger.error('JOURNEY_MATCHER_URL not configured — degrading to AWAITING_JOURNEY_TIME', {
        correlationId,
      });
      return {
        response: 'Route lookup is unavailable right now. Please provide your departure time to continue.',
        nextState: FSMState.AWAITING_JOURNEY_TIME,
        stateData: { ...workingStateData },
      };
    }

    logger.info('AC-4: Full extraction — attempting auto route match', {
      correlationId,
      origin,
      destination,
      travelDate,
      departureTime,
    });

    return callRoutesMatcher(workingStateData, logger, correlationId, journeyMatcherUrl);
  }

  // AC-5: Stations + date, no time → ask for time
  if (hasStations && hasDate && !hasTime) {
    logger.info('AC-5: Stations + date extracted, routing to AWAITING_JOURNEY_TIME', {
      correlationId,
      origin,
      destination,
      travelDate,
    });
    return {
      response: `I have your stations and date. What time did you depart?`,
      nextState: FSMState.AWAITING_JOURNEY_TIME,
      stateData: { ...workingStateData },
    };
  }

  // AC-6: Stations only, no date → ask for date
  if (hasStations && !hasDate) {
    logger.info('AC-6: Stations extracted, date missing, routing to AWAITING_JOURNEY_DATE', {
      correlationId,
      origin,
      destination,
    });
    return {
      response: `I have your stations. When did you travel? Please provide your journey date.`,
      nextState: FSMState.AWAITING_JOURNEY_DATE,
      stateData: { ...workingStateData },
    };
  }

  // AC-7: Date only, no stations → ask for stations
  if (!hasStations && hasDate) {
    logger.info('AC-7: Date extracted, stations missing, routing to AWAITING_JOURNEY_STATIONS', {
      correlationId,
      travelDate,
    });
    return {
      response: `I have your travel date. Where did you travel from and to?`,
      nextState: FSMState.AWAITING_JOURNEY_STATIONS,
      stateData: { ...workingStateData },
    };
  }

  // AC-9: No usable fields — friendly fallback
  logger.info('AC-9: No usable fields extracted, falling back to AWAITING_JOURNEY_DATE', {
    correlationId,
  });
  return {
    response: `I couldn't read your ticket clearly. Let's enter your journey details manually. When did you travel?`,
    nextState: FSMState.AWAITING_JOURNEY_DATE,
    stateData: {
      scan_id: workingStateData.scan_id,
      image_gcs_path: workingStateData.image_gcs_path,
    },
  };
}

/**
 * Handle AWAITING_OCR_REVIEW state
 *
 * AC-10: Show OCR extraction summary with YES/NO prompt
 * AC-11/S2: YES → adaptive routing through AC-4 to AC-9
 * AC-12: NO  → transition to AWAITING_JOURNEY_DATE with clean stateData
 */
export async function ocrReviewHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const logger = createLogger({ serviceName: process.env.SERVICE_NAME || 'whatsapp-handler' });
  const input = ctx.messageBody.trim().toUpperCase();
  const stateData = ctx.stateData ?? {};

  logger.info('OCR review handler invoked', {
    correlationId: ctx.correlationId,
    input,
  });

  // AC-11/S2: User confirms OCR data — adaptively route based on available fields
  if (input === 'YES') {
    return adaptiveRoute(stateData, logger, ctx.correlationId);
  }

  // AC-12: User rejects OCR data — discard and start manual flow
  if (input === 'NO') {
    return {
      response:
        "No problem! Please enter your journey details manually. When did you travel?",
      nextState: FSMState.AWAITING_JOURNEY_DATE,
      stateData: {},
    };
  }

  // AC-10: No or unrecognised input — present summary and ask for YES/NO
  const summary = buildOcrSummary(stateData);

  return {
    response: summary,
    nextState: FSMState.AWAITING_OCR_REVIEW,
    stateData: { ...stateData },
  };
}
