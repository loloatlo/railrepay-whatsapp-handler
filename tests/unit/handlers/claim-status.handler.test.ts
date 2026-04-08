/**
 * BL-152: Claim Status Handler Tests - AWAITING_CLAIM_STATUS Dead FSM State
 *
 * TECHNICAL DEBT CONTEXT:
 * FSMState.AWAITING_CLAIM_STATUS exists in the FSM enum (18 states total) but has NO
 * registered handler. Any user who reaches this state (e.g. via STATUS command from
 * AUTHENTICATED) triggers "No handler registered for state: AWAITING_CLAIM_STATUS",
 * which is an unhandled error causing a 500.
 *
 * REQUIRED FIX (Option A - Stub Handler):
 * - AC-1: AWAITING_CLAIM_STATUS has a registered handler in the handler registry
 * - AC-2: Stub handler returns a user-friendly "coming soon" message and transitions
 *         back to AUTHENTICATED state
 *
 * Per ADR-014: Tests written FIRST, implementation follows
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 *
 * FSM CONTEXT:
 * TRIGGER: User reaches AWAITING_CLAIM_STATUS state (entered from authenticated handler STATUS flow)
 * OUTPUT: Handler transitions user back to AUTHENTICATED (stub - feature not yet available)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// Mock winston logger (shared instance per CLAUDE.md Section 6.1.11)
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// Import handler after mocks
// NOTE: This import will fail (RED) until Blake creates src/handlers/claim-status.handler.ts
import { claimStatusHandler } from '../../../src/handlers/claim-status.handler';

describe('BL-152: Claim Status Handler (AWAITING_CLAIM_STATUS Stub)', () => {
  let mockContext: HandlerContext;
  let mockUser: User;

  beforeEach(() => {
    mockUser = {
      id: 'user-456',
      phone_number: '+447700900456',
      verified_at: new Date('2025-01-10T09:00:00Z'),
      created_at: new Date('2025-01-10T09:00:00Z'),
      updated_at: new Date('2025-01-10T09:00:00Z'),
    };

    mockContext = {
      phoneNumber: '+447700900456',
      messageBody: 'STATUS',
      messageSid: 'SM_CLAIM_STATUS_001',
      user: mockUser,
      currentState: FSMState.AWAITING_CLAIM_STATUS,
      correlationId: 'test-claim-status-corr-id',
    };

    vi.clearAllMocks();
  });

  // AC-1: AWAITING_CLAIM_STATUS has a registered handler
  describe('AC-1: Handler exists and is callable', () => {
    it('should export a claimStatusHandler function', () => {
      // AC-1: Verifies the module exports a callable handler
      expect(typeof claimStatusHandler).toBe('function');
    });

    it('should return a HandlerResult when called', async () => {
      // AC-1: Handler must return a valid HandlerResult (response + nextState)
      const result = await claimStatusHandler(mockContext);

      expect(result).toBeDefined();
      expect(typeof result.response).toBe('string');
      expect(result.response.length).toBeGreaterThan(0);
    });
  });

  // AC-2: Stub handler returns user-friendly "coming soon" message and transitions to AUTHENTICATED
  describe('AC-2: Returns coming-soon message and transitions to AUTHENTICATED', () => {
    it('should return a user-friendly message indicating claim status is not yet available', async () => {
      // AC-2: Message must communicate that the feature is coming soon
      // It should NOT return an error or blank response

      const result = await claimStatusHandler(mockContext);

      // Must be a non-empty, non-error message (not "Sorry, an error occurred")
      expect(result.response.length).toBeGreaterThan(20);
      // Must communicate unavailability in a friendly way — one of these phrases expected
      const responseUpper = result.response.toUpperCase();
      const hasFriendlyUnavailableMessage =
        responseUpper.includes('NOT YET AVAILABLE') ||
        responseUpper.includes('COMING SOON') ||
        responseUpper.includes('AVAILABLE SOON') ||
        responseUpper.includes('WORKING ON') ||
        responseUpper.includes("ISN'T AVAILABLE") ||
        responseUpper.includes('NOT AVAILABLE');
      expect(hasFriendlyUnavailableMessage).toBe(true);
    });

    it('should mention the MENU command so user knows how to continue', async () => {
      // AC-2: User must be given an actionable next step (e.g. MENU or DELAY)
      const result = await claimStatusHandler(mockContext);

      const responseUpper = result.response.toUpperCase();
      const hasNextStep =
        responseUpper.includes('MENU') ||
        responseUpper.includes('DELAY') ||
        responseUpper.includes('HELP');
      expect(hasNextStep).toBe(true);
    });

    it('should transition nextState to AUTHENTICATED', async () => {
      // AC-2: Stub must return the user to the main menu (AUTHENTICATED)
      // This prevents the dead-state trap where the user is stuck in AWAITING_CLAIM_STATUS

      const result = await claimStatusHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should NOT publish any events (stub handler has no side effects)', async () => {
      // AC-2: Stub handler should not produce outbox events
      const result = await claimStatusHandler(mockContext);

      expect(result.publishEvents).toBeUndefined();
    });
  });

  describe('FSM transition correctness', () => {
    it('should NOT transition to AWAITING_CLAIM_STATUS (must escape the dead state)', async () => {
      // REGRESSION: Transitioning back to AWAITING_CLAIM_STATUS would loop infinitely
      const result = await claimStatusHandler(mockContext);

      expect(result.nextState).not.toBe(FSMState.AWAITING_CLAIM_STATUS);
    });

    it('should NOT omit nextState (staying in current state would also trap the user)', async () => {
      // REGRESSION: A handler that returns no nextState stays in the same state —
      // for AWAITING_CLAIM_STATUS that means the user is permanently stuck.
      const result = await claimStatusHandler(mockContext);

      expect(result.nextState).toBeDefined();
    });
  });

  describe('Observability and logging', () => {
    it('should log that the claim status state was reached, with correlation ID', async () => {
      await claimStatusHandler({
        ...mockContext,
        correlationId: 'bl-152-corr-789',
      });

      expect(sharedLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          correlationId: 'bl-152-corr-789',
        })
      );
    });
  });

  describe('Edge cases and resilience', () => {
    it('should handle missing user gracefully (ctx.user is null)', async () => {
      // RESILIENCE: Stub handler must work even if user context is missing
      const result = await claimStatusHandler({
        ...mockContext,
        user: null,
      });

      expect(result.response.length).toBeGreaterThan(0);
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should handle any message body (handler does not depend on user input)', async () => {
      // BEHAVIOR: Stub always returns the same coming-soon message regardless of input
      const result1 = await claimStatusHandler({ ...mockContext, messageBody: 'STATUS' });
      const result2 = await claimStatusHandler({ ...mockContext, messageBody: 'check status' });
      const result3 = await claimStatusHandler({ ...mockContext, messageBody: 'ANYTHING' });

      expect(result1.response).toEqual(result2.response);
      expect(result2.response).toEqual(result3.response);
      expect(result1.nextState).toBe(FSMState.AUTHENTICATED);
    });
  });
});
