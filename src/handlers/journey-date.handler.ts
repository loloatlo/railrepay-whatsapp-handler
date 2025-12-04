/**
 * Journey Date Handler - Collect journey date
 *
 * SPEC: Day 5 § 2.5 Journey Date Handler
 * Per ADR-014: Implementation written AFTER tests
 *
 * BEHAVIOR:
 * - Valid date (use date-parser) → Store in state, send JOURNEY_STATIONS, transition to AWAITING_JOURNEY_STATIONS
 * - Future date → Error message
 * - Date >90 days ago → Error message
 * - Invalid date → Send ERROR_INVALID_INPUT with hint
 */

import type { HandlerContext, HandlerResult } from './index';
import { FSMState } from '../services/fsm.service';
import { parseDate } from '../utils/date-parser';

/**
 * Handle AWAITING_JOURNEY_DATE state
 * Collects and validates journey date
 */
export async function journeyDateHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const result = parseDate(ctx.messageBody);

  // Invalid date format
  if (!result.success) {
    return {
      response: `${result.error}

Please try again with a valid date like:
• "today"
• "yesterday"
• "15 Nov"
• "15/11/2024"`,
      nextState: FSMState.AWAITING_JOURNEY_DATE,
    };
  }

  // Valid date - store and move to next step
  return {
    response: `Got it! Journey date: ${result.date.toLocaleDateString('en-GB')}

Now, which stations did you travel between?

For example:
• "Kings Cross to Edinburgh"
• "Manchester to London"
• "Brighton to Victoria"`,
    nextState: FSMState.AWAITING_JOURNEY_STATIONS,
    stateData: {
      journeyDate: result.date.toISOString(),
    },
  };
}
