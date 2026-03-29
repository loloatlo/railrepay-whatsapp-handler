/**
 * Authenticated Handler - Main menu for verified users
 *
 * SPEC: Day 5 § 2.4 Authenticated Handler
 * Per ADR-014: Implementation written AFTER tests
 *
 * BEHAVIOR:
 * - "DELAY" or "delay" or "claim" → Send ticket-or-manual prompt, transition to AWAITING_TICKET_OR_MANUAL
 *   (BL-167 AC-1: changed from AWAITING_JOURNEY_DATE)
 * - "STATUS" → Send status check message (placeholder for now)
 * - "HELP" → Send help menu
 * - "LOGOUT" → Delete state, send goodbye
 */

import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';

/**
 * Handle AUTHENTICATED state
 * Main menu for verified users
 */
export async function authenticatedHandler(ctx: HandlerContext): Promise<HandlerResult> {
  const input = ctx.messageBody.trim().toUpperCase();

  // Start delay claim flow
  // BL-167 AC-1: transitions to AWAITING_TICKET_OR_MANUAL (not AWAITING_JOURNEY_DATE)
  if (input === 'DELAY' || input === 'CLAIM') {
    return {
      response: `Great! Let's report your delayed journey.

Send a photo of your ticket to get started quickly, or type MANUAL to enter your journey details.`,
      nextState: FSMState.AWAITING_TICKET_OR_MANUAL,
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
