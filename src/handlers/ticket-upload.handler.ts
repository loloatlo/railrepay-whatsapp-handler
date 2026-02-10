/**
 * Ticket Upload Handler - Handle ticket photo upload
 *
 * SPEC: Day 5 § 2.9 Ticket Upload Handler
 * Per ADR-014: Implementation written AFTER tests
 */

import { randomUUID } from 'crypto';
import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import type { OutboxEvent } from '../db/types.js';

export async function ticketUploadHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const input = ctx.messageBody.trim().toUpperCase();

  // Check for media upload first (takes precedence)
  if (ctx.mediaUrl) {
    return createJourneyAndRespond(ctx, ctx.mediaUrl);
  }

  // Handle SKIP for MVP
  if (input === 'SKIP') {
    return createJourneyAndRespond(ctx, null);
  }

  // No media and not SKIP
  return {
    response: `Please send a photo of your ticket, or reply SKIP to continue without one.

You can:
• Take a photo of your physical ticket
• Screenshot your e-ticket
• Upload your ticket PDF`,
    nextState: FSMState.AWAITING_TICKET_UPLOAD,
  };
}

function createJourneyAndRespond(
  ctx: HandlerContext,
  ticketUrl: string | null
): HandlerResult {
  // Extract journey data from stateData
  const journeyId = ctx.stateData?.journeyId || randomUUID();
  const travelDate = ctx.stateData?.travelDate;
  const matchedRoute = ctx.stateData?.matchedRoute || ctx.stateData?.confirmedRoute;

  // Build base payload with enriched journey data
  const payload: Record<string, any> = {
    user_id: ctx.user?.id,
    phone_number: ctx.phoneNumber,
    ticket_url: ticketUrl,
    created_at: new Date().toISOString(),
    correlation_id: ctx.correlationId,
    causation_id: ctx.messageSid,
  };

  // Add journey fields if available in stateData (AC-1 through AC-6)
  if (ctx.stateData) {
    // AC-1: journey_id from stateData.journeyId
    payload.journey_id = journeyId;

    // AC-2: origin_crs and destination_crs
    if (ctx.stateData.origin) {
      payload.origin_crs = ctx.stateData.origin;
    }
    if (ctx.stateData.destination) {
      payload.destination_crs = ctx.stateData.destination;
    }

    // AC-3, AC-4, AC-6: departure_datetime, arrival_datetime, legs array
    if (matchedRoute && matchedRoute.legs && matchedRoute.legs.length > 0) {
      const firstLeg = matchedRoute.legs[0];
      const lastLeg = matchedRoute.legs[matchedRoute.legs.length - 1];

      // AC-3: departure_datetime (combine travelDate + first leg departure time)
      if (travelDate && firstLeg.departure) {
        payload.departure_datetime = `${travelDate}T${firstLeg.departure}:00Z`;
      }

      // AC-4: arrival_datetime (combine travelDate + last leg arrival time)
      if (travelDate && lastLeg.arrival) {
        payload.arrival_datetime = `${travelDate}T${lastLeg.arrival}:00Z`;
      }

      // AC-6: legs array with full segment data
      payload.legs = matchedRoute.legs.map((leg: any) => ({
        from: leg.from,
        to: leg.to,
        departure: leg.departure,
        arrival: leg.arrival,
        operator: leg.operator,
        tripId: leg.tripId || null,
      }));
    }

    // AC-5: journey_type (default 'single' for MVP)
    payload.journey_type = 'single';
  }

  // Create journey.created event
  const journeyEvent: OutboxEvent = {
    id: randomUUID(),
    aggregate_type: 'journey',
    aggregate_id: journeyId,
    event_type: 'journey.created',
    payload,
    published_at: null,
    created_at: new Date(),
  };

  return {
    response: `✓ Journey submitted successfully!

We'll process your claim and notify you of any updates.

What would you like to do next?

Reply with:
• DELAY - Report another delayed journey
• STATUS - Check your claim status
• HELP - Get help`,
    nextState: FSMState.AUTHENTICATED,
    publishEvents: [journeyEvent],
    stateData: {
      ticketUrl: ticketUrl || undefined,
    },
  };
}
