/**
 * Journey Confirm Handler - Confirm journey details
 *
 * SPEC: Day 5 § 2.8 Journey Confirm Handler
 * Per ADR-014: Implementation written AFTER tests
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';

export async function journeyConfirmHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const input = ctx.messageBody.trim().toUpperCase();

  if (input === 'YES') {
    return {
      response: `Perfect! Now please send a photo of your ticket.

You can:
• Take a photo of your physical ticket
• Screenshot your e-ticket
• Upload your ticket PDF

Or reply SKIP to submit without a ticket (for MVP testing).`,
      nextState: FSMState.AWAITING_TICKET_UPLOAD,
    };
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
