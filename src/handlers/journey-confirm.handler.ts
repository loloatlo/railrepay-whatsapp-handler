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
      response: `Perfect! Let me check for alternative routing options that might be eligible for compensation...`,
      nextState: FSMState.AWAITING_ROUTING_CONFIRM,
      stateData: {
        journeyId: ctx.stateData?.journeyId,
        origin: ctx.stateData?.origin,
        destination: ctx.stateData?.destination,
        travelDate: ctx.stateData?.travelDate,
        departureTime: ctx.stateData?.departureTime,
      },
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
