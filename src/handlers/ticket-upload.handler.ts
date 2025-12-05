/**
 * Ticket Upload Handler - Handle ticket photo upload
 *
 * SPEC: Day 5 § 2.9 Ticket Upload Handler
 * Per ADR-014: Implementation written AFTER tests
 */

import { randomUUID } from 'crypto';
import type { HandlerContext, HandlerResult } from './index';
import { FSMState } from '../services/fsm.service.js';
import type { OutboxEvent } from '../db/types';

export async function ticketUploadHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const input = ctx.messageBody.trim().toUpperCase();

  // Handle SKIP for MVP
  if (input === 'SKIP') {
    return createJourneyAndRespond(ctx, null);
  }

  // Check for media upload
  if (ctx.mediaUrl) {
    return createJourneyAndRespond(ctx, ctx.mediaUrl);
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
  // Create journey.created event
  const journeyEvent: OutboxEvent = {
    id: randomUUID(),
    aggregate_type: 'journey',
    aggregate_id: randomUUID(), // New journey ID
    event_type: 'journey.created',
    payload: {
      user_id: ctx.user?.id,
      phone_number: ctx.phoneNumber,
      ticket_url: ticketUrl,
      created_at: new Date().toISOString(),
      correlation_id: ctx.correlationId,
      causation_id: ctx.messageSid,
    },
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
