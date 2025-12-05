/**
 * Journey Time Handler - Collect journey time
 *
 * SPEC: Day 5 § 2.7 Journey Time Handler
 * Per ADR-014: Implementation written AFTER tests
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import { parseTime } from '../utils/time-parser.js';

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

  return {
    response: `Got it! Journey time: ${timeStr}

Please confirm your journey details:
• Date: [from previous step]
• Route: [from previous step]
• Time: ${timeStr}

Reply YES to confirm, or NO to start over.`,
    nextState: FSMState.AWAITING_JOURNEY_CONFIRM,
    stateData: {
      journeyTime: timeStr,
    },
  };
}
