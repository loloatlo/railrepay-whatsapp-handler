/**
 * Terms Handler - Handle terms acceptance flow
 *
 * SPEC: Day 5 § 2.2 Terms Handler
 * Per ADR-014: Implementation written AFTER tests
 *
 * BEHAVIOR:
 * - Input "YES" → Start verification, transition to AWAITING_OTP
 * - Input "TERMS" → Send terms URL, stay in AWAITING_TERMS
 * - Input "NO" → Send goodbye, no state transition (caller should delete state)
 * - Invalid input → Error message with hint, stay in AWAITING_TERMS
 */

import type { HandlerContext, HandlerResult } from './index';
import { FSMState } from '../services/fsm.service';

const TERMS_URL = 'https://railrepay.co.uk/terms';

/**
 * Handle AWAITING_TERMS state
 * Processes user's terms acceptance decision
 */
export async function termsHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const input = ctx.messageBody.trim().toUpperCase();

  // User accepts terms → start verification
  if (input === 'YES') {
    return {
      response: `Great! I've sent a verification code to your phone.

Please reply with the 6-digit code to verify your number.

(The code will arrive via SMS)`,
      nextState: FSMState.AWAITING_OTP,
      stateData: {
        verificationStarted: true,
      },
    };
  }

  // User requests terms
  if (input === 'TERMS') {
    return {
      response: `You can read our full terms and conditions here:

${TERMS_URL}

Once you've read them, reply YES to accept and continue, or NO to opt out.`,
      nextState: FSMState.AWAITING_TERMS,
    };
  }

  // User rejects terms
  if (input === 'NO') {
    return {
      response: `I understand. You're welcome to come back anytime if you change your mind!

Just send any message to start again. 👋`,
      // No nextState - caller should delete the state
    };
  }

  // Invalid input
  return {
    response: `Sorry, I didn't understand that.

Please reply with:
• YES - to accept terms and continue
• NO - to opt out
• TERMS - to read our terms and conditions`,
    nextState: FSMState.AWAITING_TERMS,
  };
}
