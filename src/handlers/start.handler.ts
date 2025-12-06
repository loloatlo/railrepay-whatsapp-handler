/**
 * Start Handler - Entry point for all conversations
 *
 * SPEC: Day 5 § 2.1 Start Handler
 * Per ADR-014: Implementation written AFTER tests
 *
 * BEHAVIOR:
 * - New user (no user record) → Create user, send WELCOME_FIRST_TIME, transition to AWAITING_TERMS, publish user.registered
 * - Returning verified user → Send welcome back with menu, transition to AUTHENTICATED
 * - Returning unverified user → Resume verification flow, transition to AWAITING_TERMS
 */

import { randomUUID } from 'crypto';
import type { HandlerContext, HandlerResult } from './index.js';
import { FSMState } from '../services/fsm.service.js';
import type { UserRepository } from '../db/repositories/user.repository.js';
import type { OutboxEvent } from '../db/types.js';

/**
 * Handle START state
 * Determines user journey based on verification status
 *
 * Bug Fix: Create user record when ctx.user is null (prevents "User required" error in OTP handler)
 */
export async function startHandler(
  ctx: HandlerContext,
  userRepository?: UserRepository
): Promise<HandlerResult> {
  // Case 1: No user record (brand new user)
  if (!ctx.user) {
    // Bug Fix: Create user record if userRepository is provided
    if (userRepository) {
      const newUser = await userRepository.create({
        phone_number: ctx.phoneNumber,
      });

      // Publish user.registered event
      const registeredEvent: OutboxEvent = {
        id: randomUUID(),
        aggregate_type: 'user',
        aggregate_id: newUser.id,
        event_type: 'user.registered',
        payload: {
          user_id: newUser.id,
          phone_number: newUser.phone_number,
          registered_at: newUser.created_at.toISOString(),
          correlation_id: ctx.correlationId,
          causation_id: ctx.messageSid,
        },
        published_at: null,
        created_at: new Date(),
      };

      return {
        response: `Welcome to RailRepay! 🚂

I help you claim compensation for delayed trains automatically.

To get started, I need to verify your phone number. Reply YES to receive a verification code, or TERMS to read our terms of service first.`,
        nextState: FSMState.AWAITING_TERMS,
        publishEvents: [registeredEvent],
      };
    }

    // Backward compatibility: If no userRepository, just return welcome message
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
