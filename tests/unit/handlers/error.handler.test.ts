/**
 * TD-WHATSAPP-054: ERROR Handler Tests - Generic Error Recovery
 *
 * TECHNICAL DEBT CONTEXT:
 * FSMState.ERROR exists in the FSM enum but has NO registered handler.
 * Users who exhaust all routing alternatives (or hit other errors) reach an unhandled state.
 *
 * REQUIRED FIX:
 * - AC-5: Register ERROR handler that sends apology message and transitions to AUTHENTICATED
 * - Handler must be GENERIC (not routing-specific) for reusability
 * - Handler does NOT publish events (calling handler publishes before transitioning to ERROR)
 *
 * Per ADR-014: Tests written FIRST, implementation follows
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// Mock winston logger (shared instance per Section 6.1.11)
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
import { errorHandler } from '../../../src/handlers/error.handler';

describe('TD-WHATSAPP-054: ERROR Handler (Generic Error Recovery)', () => {
  let mockContext: HandlerContext;
  let mockUser: User;

  beforeEach(() => {
    mockUser = {
      id: 'user-123',
      phone_number: '+447700900123',
      verified_at: new Date('2024-11-20T10:00:00Z'),
      created_at: new Date('2024-11-20T10:00:00Z'),
      updated_at: new Date('2024-11-20T10:00:00Z'),
    };

    mockContext = {
      phoneNumber: '+447700900123',
      messageBody: 'ANY_INPUT', // ERROR handler ignores input
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.ERROR,
      correlationId: 'test-corr-id',
    };

    vi.clearAllMocks();
  });

  describe('AC-5: ERROR handler sends apology message and transitions to AUTHENTICATED', () => {
    it('should send user-friendly apology message mentioning escalation to support team', async () => {
      // AC-5: Generic error message explaining situation and next steps

      const result = await errorHandler(mockContext);

      expect(result.response).toContain('Sorry');
      expect(result.response).toContain('escalated');
      expect(result.response).toContain('support team');
      expect(result.response).toContain('24 hours');
    });

    it('should mention MENU and CHECK commands in response', async () => {
      // BEHAVIOR: User should know they can start a new claim or check existing

      const result = await errorHandler(mockContext);

      expect(result.response).toContain('MENU');
      expect(result.response).toContain('CHECK');
    });

    it('should transition to AUTHENTICATED state (not stay in ERROR)', async () => {
      // AC-5: Error handler recovers by returning to authenticated menu

      const result = await errorHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should NOT publish any events (event publishing is responsibility of calling handler)', async () => {
      // AC-5: ERROR handler does NOT publish events
      // The handler that transitions TO error (e.g., routing-alternative) publishes escalation event BEFORE transitioning

      const result = await errorHandler(mockContext);

      expect(result.publishEvents).toBeUndefined();
    });
  });

  describe('Observability and logging', () => {
    it('should log error recovery with correlation ID', async () => {
      // REQUIREMENT: All handlers log with correlation ID for distributed tracing

      await errorHandler({
        ...mockContext,
        correlationId: 'test-error-correlation-123',
      });

      expect(sharedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('ERROR state'),
        expect.objectContaining({
          correlationId: 'test-error-correlation-123',
        })
      );
    });

    it('should log phone number for debugging', async () => {
      await errorHandler(mockContext);

      expect(sharedLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          phoneNumber: '+447700900123',
        })
      );
    });
  });

  describe('Edge cases and resilience', () => {
    it('should handle missing user gracefully (ctx.user is null)', async () => {
      // RESILIENCE: Handler should work even if user context is missing

      const result = await errorHandler({
        ...mockContext,
        user: null,
      });

      expect(result.response).toContain('Sorry');
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should handle missing stateData gracefully', async () => {
      const result = await errorHandler({
        ...mockContext,
        stateData: undefined,
      });

      expect(result.response).toContain('Sorry');
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should ignore user input (ERROR handler is not interactive)', async () => {
      // BEHAVIOR: ERROR handler always sends same message regardless of input

      const result1 = await errorHandler({ ...mockContext, messageBody: 'MENU' });
      const result2 = await errorHandler({ ...mockContext, messageBody: 'CHECK' });
      const result3 = await errorHandler({ ...mockContext, messageBody: 'RANDOM_TEXT' });

      expect(result1.response).toEqual(result2.response);
      expect(result2.response).toEqual(result3.response);
      expect(result1.nextState).toBe(FSMState.AUTHENTICATED);
      expect(result2.nextState).toBe(FSMState.AUTHENTICATED);
      expect(result3.nextState).toBe(FSMState.AUTHENTICATED);
    });
  });
});
