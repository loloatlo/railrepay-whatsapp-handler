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

import { randomUUID } from 'crypto';
import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import type { OutboxEvent } from '../db/types.js';
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

    const hasTicketFromOcr = !!ctx.stateData?.scan_id;

    logger.info('Journey confirmed by user', {
      correlationId: ctx.correlationId,
      journeyId,
      isDirect,
      legCount: matchedRoute.legs?.length,
      hasTicketFromOcr,
    });

    const confirmedStateData = {
      ...ctx.stateData,
      confirmedRoute: matchedRoute,
      journeyConfirmed: true,
    };

    // If the user entered via OCR ticket upload, the ticket is already on file
    // — skip the upload step and go straight to submission
    if (hasTicketFromOcr) {
      const travelDate = ctx.stateData?.travelDate;
      const today = new Date().toISOString().split('T')[0];
      const isHistoric = travelDate && travelDate < today;

      const responseMsg = isHistoric
        ? `Great! Your journey is confirmed and your ticket is already on file. Journey submitted successfully! We're now checking if this service was delayed and whether you're eligible for compensation. We'll message you shortly with the result.`
        : `Great! Your journey is confirmed and your ticket is already on file. Journey submitted successfully! We'll monitor this service and notify you of any delays.`;

      // TD-WHATSAPP-063: Build journey.confirmed outbox event to trigger downstream pipeline
      const journeyIdForEvent = ctx.stateData?.journeyId || randomUUID();
      const firstLeg = matchedRoute.legs?.[0];
      const lastLeg = matchedRoute.legs?.[matchedRoute.legs.length - 1];

      const segments = (matchedRoute.legs || []).map((leg: any, index: number) => ({
        sequence: index + 1,
        origin_crs: leg.from,
        destination_crs: leg.to,
        scheduled_departure: travelDate && leg.departure ? `${travelDate}T${leg.departure}:00Z` : leg.departure,
        scheduled_arrival: travelDate && leg.arrival ? `${travelDate}T${leg.arrival}:00Z` : leg.arrival,
        toc_code: leg.operator,
        rid: leg.tripId || null,
      }));

      const journeyConfirmedPayload: Record<string, any> = {
        journey_id: journeyIdForEvent,
        user_id: ctx.user?.id,
        origin_crs: ctx.stateData?.origin,
        destination_crs: ctx.stateData?.destination,
        departure_datetime: travelDate && firstLeg?.departure ? `${travelDate}T${firstLeg.departure}:00Z` : firstLeg?.departure,
        arrival_datetime: travelDate && lastLeg?.arrival ? `${travelDate}T${lastLeg.arrival}:00Z` : lastLeg?.arrival,
        journey_type: 'single',
        toc_code: firstLeg?.operator,
        segments,
        correlation_id: ctx.correlationId,
        scan_id: ctx.stateData?.scan_id,
        image_gcs_path: ctx.stateData?.image_gcs_path,
      };

      const journeyEvent: OutboxEvent = {
        id: randomUUID(),
        aggregate_type: 'journey',
        aggregate_id: journeyIdForEvent,
        event_type: 'journey.confirmed',
        payload: journeyConfirmedPayload,
        published_at: null,
        created_at: new Date(),
      };

      return {
        response: responseMsg,
        nextState: FSMState.AUTHENTICATED,
        stateData: confirmedStateData,
        publishEvents: [journeyEvent],
      };
    }

    return {
      response: `Great! Your journey is confirmed.

Now please upload a photo of your ticket.`,
      nextState: FSMState.AWAITING_TICKET_UPLOAD,
      stateData: confirmedStateData,
    };
  }

  if (input === 'NO') {
    const { journeyId, allRoutes } = ctx.stateData || {};

    // AC-1: Check if only 1 route available (or allRoutes missing)
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
