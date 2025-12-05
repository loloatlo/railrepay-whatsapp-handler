/**
 * Handler Registry - FSM State Handlers
 *
 * SPEC: Day 5 § 1. Handler Registry
 * Per ADR-014: Implementation written AFTER tests
 *
 * DESIGN:
 * - Central registry for state-specific message handlers
 * - Each handler receives HandlerContext and returns HandlerResult
 * - Handlers are pure functions that can be tested in isolation
 *
 * ARCHITECTURE:
 * - Registry pattern for extensibility (easy to add new states)
 * - Handler functions are async (may call external services)
 * - HandlerResult includes next state, data, and events to publish
 */

import type { FSMState } from '../services/fsm.service.js';
import type { User, OutboxEvent } from '../db/types';

/**
 * Context passed to every handler
 * Contains all information needed to process a message
 */
export interface HandlerContext {
  phoneNumber: string; // E.164 format
  messageBody: string; // User's message text
  messageSid: string; // Twilio message SID
  mediaUrl?: string; // Optional media URL (for photo uploads)
  user: User | null; // User record (null if not registered)
  currentState: FSMState; // Current FSM state
  correlationId: string; // For distributed tracing (ADR-002)
}

/**
 * Result returned by every handler
 * Defines what happens next in the conversation
 */
export interface HandlerResult {
  response: string; // TwiML body text to send to user
  nextState?: FSMState; // State to transition to (omit to stay in current state)
  stateData?: Record<string, any>; // Data to store with the state
  publishEvents?: OutboxEvent[]; // Events to publish via outbox
}

/**
 * Handler function signature
 * All handlers must implement this interface
 */
export type Handler = (ctx: HandlerContext) => Promise<HandlerResult>;

/**
 * Internal handler registry
 * Maps FSMState → Handler function
 */
const handlerRegistry = new Map<FSMState, Handler>();

/**
 * Register a handler for a specific FSM state
 *
 * @param state - FSM state to handle
 * @param handler - Handler function
 */
export function registerHandler(state: FSMState, handler: Handler): void {
  handlerRegistry.set(state, handler);
}

/**
 * Get handler for a specific FSM state
 *
 * @param state - FSM state
 * @returns Handler function
 * @throws Error if no handler registered for state
 */
export function getHandler(state: FSMState): Handler {
  const handler = handlerRegistry.get(state);

  if (!handler) {
    throw new Error(`No handler registered for state: ${state}`);
  }

  return handler;
}

/**
 * Clear all registered handlers (for testing)
 * NOT exported in production - only for test setup
 */
export function clearHandlers(): void {
  handlerRegistry.clear();
}

/**
 * Initialize all handlers
 * Registers handlers for each FSM state
 * Call this once at application startup
 */
export async function initializeHandlers(): Promise<void> {
  const { FSMState } = await import('../services/fsm.service.js');
  const { startHandler } = await import('./start.handler.js');
  const { termsHandler } = await import('./terms.handler.js');
  const { otpHandler } = await import('./otp.handler.js');
  const { authenticatedHandler } = await import('./authenticated.handler.js');
  const { journeyDateHandler } = await import('./journey-date.handler.js');
  const { journeyStationsHandler } = await import('./journey-stations.handler.js');
  const { journeyTimeHandler } = await import('./journey-time.handler.js');
  const { journeyConfirmHandler } = await import('./journey-confirm.handler.js');
  const { ticketUploadHandler } = await import('./ticket-upload.handler.js');

  registerHandler(FSMState.START, startHandler);
  registerHandler(FSMState.AWAITING_TERMS, termsHandler);
  registerHandler(FSMState.AWAITING_OTP, otpHandler);
  registerHandler(FSMState.AUTHENTICATED, authenticatedHandler);
  registerHandler(FSMState.AWAITING_JOURNEY_DATE, journeyDateHandler);
  registerHandler(FSMState.AWAITING_JOURNEY_STATIONS, journeyStationsHandler);
  registerHandler(FSMState.AWAITING_JOURNEY_TIME, journeyTimeHandler);
  registerHandler(FSMState.AWAITING_JOURNEY_CONFIRM, journeyConfirmHandler);
  registerHandler(FSMState.AWAITING_TICKET_UPLOAD, ticketUploadHandler);
}
