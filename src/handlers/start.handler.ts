/**
 * Start Handler - Entry point for all conversations
 *
 * SPEC: Day 5 § 2.1 Start Handler
 * Per ADR-014: Implementation written AFTER tests
 *
 * BEHAVIOR:
 * - New user (no user record) → Send WELCOME_FIRST_TIME, transition to AWAITING_TERMS
 * - Returning verified user → Send welcome back with menu, transition to AUTHENTICATED
 * - Returning unverified user → Resume verification flow, transition to AWAITING_TERMS
 */

import type { HandlerContext, HandlerResult } from './index';
import { FSMState } from '../services/fsm.service.js';

/**
 * Handle START state
 * Determines user journey based on verification status
 */
export async function startHandler(ctx: HandlerContext): Promise<HandlerResult> {
  // Case 1: No user record (brand new user)
  if (!ctx.user) {
    return {
      response: `Welcome to RailRepay! 🚂

I help you claim compensation for delayed trains automatically.

To get started, I need to verify your phone number. Reply YES to receive a verification code, or TERMS to read our terms of service first.`,
      nextState: FSMState.AWAITING_TERMS,
    };
  }

  // Case 2: Returning user with verification complete
  if (ctx.user.verified_at) {
    return {
      response: `Welcome back! 👋

What would you like to do today?

Reply with:
• DELAY - Report a delayed journey
• STATUS - Check your claim status
• HELP - Get help

Or just tell me about your delayed journey.`,
      nextState: FSMState.AUTHENTICATED,
    };
  }

  // Case 3: Returning user without verification (incomplete registration)
  return {
    response: `Welcome back! You haven't completed verification yet.

To continue, I need to verify your phone number. Reply YES to receive a verification code, or TERMS to read our terms of service first.`,
    nextState: FSMState.AWAITING_TERMS,
  };
}
