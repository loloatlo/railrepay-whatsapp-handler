/**
 * Authenticated Handler - Main menu for verified users
 *
 * SPEC: Day 5 § 2.4 Authenticated Handler
 * Per ADR-014: Implementation written AFTER tests
 *
 * BEHAVIOR:
 * - "DELAY" or "delay" or "claim" → Send JOURNEY_WHEN, transition to AWAITING_JOURNEY_DATE
 * - "STATUS" → Send status check message (placeholder for now)
 * - "HELP" → Send help menu
 * - "LOGOUT" → Delete state, send goodbye
 */

import type { HandlerContext, HandlerResult } from './index';
import { FSMState } from '../services/fsm.service';

/**
 * Handle AUTHENTICATED state
 * Main menu for verified users
 */
export async function authenticatedHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const input = ctx.messageBody.trim().toUpperCase();

  // Start delay claim flow
  if (input === 'DELAY' || input === 'CLAIM') {
    return {
      response: `Great! Let's report your delayed journey.

When did you travel? (when was your journey?)

You can say:
• "today"
• "yesterday"
• "15 Nov"
• "15/11/2024"

(Claims must be made within 90 days of travel)`,
      nextState: FSMState.AWAITING_JOURNEY_DATE,
    };
  }

  // Check claim status
  if (input === 'STATUS') {
    return {
      response: `Here's the status of your claims:

(No active claims yet)

Reply DELAY to start a new claim, or HELP for more options.`,
      nextState: FSMState.AUTHENTICATED,
    };
  }

  // Show help menu
  if (input === 'HELP') {
    return {
      response: `Here's what I can help you with:

Commands:
• DELAY - Report a delayed journey
• STATUS - Check your claim status
• HELP - Show this menu
• LOGOUT - Sign out

Just type the command you want, or describe your delayed journey in your own words!`,
      nextState: FSMState.AUTHENTICATED,
    };
  }

  // Logout
  if (input === 'LOGOUT') {
    return {
      response: `You've been signed out. Thanks for using RailRepay!

Send any message to start again. goodbye! 👋`,
      // No nextState - caller should delete the state
    };
  }

  // Invalid input
  return {
    response: `Sorry, I didn't understand that.

Try one of these commands:
• DELAY - Report a delayed journey
• STATUS - Check your claim status
• HELP - Get help
• LOGOUT - Sign out

Or just tell me about your delayed journey!`,
    nextState: FSMState.AUTHENTICATED,
  };
}
