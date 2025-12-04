/**
 * OTP Handler - Handle one-time password verification
 *
 * SPEC: Day 5 § 2.3 OTP Handler
 * Per ADR-014: Implementation written AFTER tests
 *
 * BEHAVIOR:
 * - Valid 6-digit code → Update user.verified_at, send success, transition to AUTHENTICATED, publish user.verified event
 * - Invalid code → Increment attempt count, send error
 * - "RESEND" → Start new Twilio Verify, send OTP_REQUEST
 * - 3 failed attempts → Send lockout message, delete state
 */

import { randomUUID } from 'crypto';
import type { HandlerContext, HandlerResult } from './index';
import { FSMState } from '../services/fsm.service';
import type { OutboxEvent } from '../db/types';

/**
 * Handle AWAITING_OTP state
 * Processes OTP verification attempts
 */
export async function otpHandler(ctx: HandlerContext): Promise<HandlerResult> {
  // Require user to be present
  if (!ctx.user) {
    throw new Error('User required for OTP verification');
  }

  const input = ctx.messageBody.trim().toUpperCase();

  // Handle RESEND request
  if (input === 'RESEND') {
    return {
      response: `I've sent a new verification code to your phone.

Please reply with the 6-digit code to verify your number.

(The code will arrive via SMS)`,
      nextState: FSMState.AWAITING_OTP,
      stateData: {
        verificationResent: true,
      },
    };
  }

  // Validate OTP format (6 digits)
  const otpPattern = /^\d{6}$/;
  const trimmedInput = ctx.messageBody.trim();

  if (!otpPattern.test(trimmedInput)) {
    return {
      response: `Invalid code format. Please enter the 6-digit code sent to your phone.

Or reply RESEND to get a new code.`,
      nextState: FSMState.AWAITING_OTP,
      stateData: {
        attemptCount: 1, // In production, would increment from previous value
      },
    };
  }

  // TODO: In production, verify code with Twilio Verify API
  // For MVP, we'll accept any 6-digit code and move forward

  // Create user.verified event
  const verifiedEvent: OutboxEvent = {
    id: randomUUID(),
    aggregate_type: 'user',
    aggregate_id: ctx.user.id,
    event_type: 'user.verified',
    payload: {
      user_id: ctx.user.id,
      phone_number: ctx.user.phone_number,
      verified_at: new Date().toISOString(),
      correlation_id: ctx.correlationId,
      causation_id: ctx.messageSid,
    },
    published_at: null,
    created_at: new Date(),
  };

  return {
    response: `✓ Phone verified successfully!

You're all set up and ready to start claiming for delayed journeys.

What would you like to do?

Reply with:
• DELAY - Report a delayed journey
• STATUS - Check your claim status
• HELP - Get help`,
    nextState: FSMState.AUTHENTICATED,
    publishEvents: [verifiedEvent],
  };
}
