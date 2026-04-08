/**
 * BL-152 AC-5: Handler Registry Completeness Test
 *
 * TECHNICAL DEBT CONTEXT:
 * The FSM has 18 states but only 17 handlers are registered. FSMState.AWAITING_CLAIM_STATUS
 * has no handler, causing a runtime crash ("No handler registered for state:
 * AWAITING_CLAIM_STATUS") whenever a user reaches that state.
 *
 * REQUIRED FIX:
 * - AC-5: No FSM state exists without a registered handler.
 *         All 18 FSMState enum values must have a handler in the registry after
 *         initializeHandlers() is called.
 *
 * This test iterates every value in the FSMState enum and asserts that getHandler()
 * does NOT throw. If any state is missing a handler, the test will fail with a
 * clear message identifying the missing state.
 *
 * Per ADR-014: Tests written FIRST, implementation follows
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import { getHandler, clearHandlers, initializeHandlers } from '../../../src/handlers';

// ---------------------------------------------------------------------------
// Infrastructure mocks — all external dependencies that handlers import
// ---------------------------------------------------------------------------

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

// Mock axios (used by routing/eligibility handlers)
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Mock ioredis (used by any handler that touches FSM state directly)
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Derive the canonical list of all FSMState values at import time
// ---------------------------------------------------------------------------
const ALL_FSM_STATES = Object.values(FSMState) as FSMState[];

describe('BL-152 AC-5: Handler Registry Completeness', () => {
  beforeAll(async () => {
    // Start from a clean registry so other test files cannot mask a missing handler
    clearHandlers();
    await initializeHandlers();
  });

  it('should have exactly 18 FSM states defined in the enum', () => {
    // Baseline assertion — if the enum grows, this test will catch the discrepancy
    // so that the corresponding handler is not forgotten.
    // Update this count when new states are intentionally added.
    expect(ALL_FSM_STATES).toHaveLength(18);
  });

  it('should have a registered handler for every FSMState enum value', () => {
    // AC-5: Iterates ALL 18 states; fails individually per missing state for clarity.
    const missingHandlers: string[] = [];

    for (const state of ALL_FSM_STATES) {
      try {
        getHandler(state);
      } catch {
        missingHandlers.push(state);
      }
    }

    expect(missingHandlers).toEqual(
      [],
      // Custom message makes the failure immediately actionable
      `The following FSM states have no registered handler: ${missingHandlers.join(', ')}`
    );
  });

  // Individual per-state assertions so that a test run with --reporter=verbose
  // shows exactly which states pass or fail without having to parse the error message.
  describe('Per-state handler presence assertions', () => {
    for (const state of ALL_FSM_STATES) {
      it(`should have a handler for FSMState.${state}`, () => {
        // AC-5: Each state individually — granular failure output
        expect(() => getHandler(state)).not.toThrow();
      });
    }
  });

  describe('AWAITING_CLAIM_STATUS specifically (the dead state being fixed)', () => {
    it('should have a handler for FSMState.AWAITING_CLAIM_STATUS', () => {
      // AC-1 + AC-5: This is the specific state that was missing before BL-152
      expect(() => getHandler(FSMState.AWAITING_CLAIM_STATUS)).not.toThrow();
    });

    it('should return a callable handler for FSMState.AWAITING_CLAIM_STATUS', async () => {
      // AC-1: The returned handler must be callable and return a valid HandlerResult
      const handler = getHandler(FSMState.AWAITING_CLAIM_STATUS);
      expect(typeof handler).toBe('function');

      const result = await handler({
        phoneNumber: '+447700900789',
        messageBody: 'STATUS',
        messageSid: 'SM_REGISTRY_COMPLETENESS_001',
        user: null,
        currentState: FSMState.AWAITING_CLAIM_STATUS,
        correlationId: 'registry-completeness-corr-id',
      });

      // AC-2: Must return a response and transition to AUTHENTICATED
      expect(typeof result.response).toBe('string');
      expect(result.response.length).toBeGreaterThan(0);
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });
  });
});
