/**
 * Ticket Class Handler Tests - TD-WHATSAPP-058: Manual Ticket Class Collection
 *
 * TD CONTEXT: Second step of manual ticket flow. After the user provides a price at
 * AWAITING_TICKET_PRICE, this handler collects whether the ticket was Standard or First Class.
 *
 * REQUIRED BEHAVIOR:
 *   - Accept STANDARD or FIRST (case-insensitive)
 *   - Reject invalid input with error message
 *   - Store ticket_class in stateData (lowercased: "standard" or "first")
 *   - Transition to AWAITING_TICKET_TYPE on success
 *
 * Phase TD-1: Test Specification (Jessie)
 * These tests MUST FAIL initially - no implementation exists yet.
 * Blake will implement src/handlers/ticket-class.handler.ts in Phase TD-2.
 *
 * Test Lock Rule: Blake MUST NOT modify these tests.
 * Per ADR-014 (TDD), per ADR-004 (Vitest).
 *
 * TRIGGER: Handler reached from AWAITING_TICKET_CLASS state
 *   (ticket-price.handler transitions here after valid price entry - AC-4)
 * OUTPUT: Transitions to AWAITING_TICKET_TYPE on success (AC-6)
 *
 * Acceptance Criteria covered:
 * AC-5: ticket-class.handler accepts STANDARD or FIRST (case-insensitive). Error for invalid.
 * AC-6: After valid class entry, responds with type prompt and transitions to AWAITING_TICKET_TYPE
 * AC-9: ticket_class stored in stateData
 * AC-12: Unit tests for class selection (STANDARD, FIRST, case variants, invalid)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// AC-12: Infrastructure package mock (ADR-002 — Winston logger)
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// Import handler AFTER mocks are established
// NOTE: This import will fail (RED) until Blake creates ticket-class.handler.ts
import { ticketClassHandler } from '../../../src/handlers/ticket-class.handler';

describe('TD-WHATSAPP-058: ticket-class.handler', () => {
  let mockContext: HandlerContext;
  let mockUser: User;

  beforeEach(() => {
    mockUser = {
      id: 'user-058-class',
      phone_number: '+447700900059',
      verified_at: new Date('2026-01-10T10:00:00Z'),
      created_at: new Date('2026-01-10T10:00:00Z'),
      updated_at: new Date('2026-01-10T10:00:00Z'),
    };

    // stateData has journey data + ticket_fare_pence from previous step
    mockContext = {
      phoneNumber: '+447700900059',
      messageSid: 'SM058class',
      user: mockUser,
      currentState: FSMState.AWAITING_TICKET_CLASS,
      correlationId: 'test-corr-058-class',
      messageBody: '',
      stateData: {
        journeyId: 'journey-058-002',
        origin: 'MAN',
        destination: 'EUS',
        travelDate: '2026-03-07',
        ticket_fare_pence: 6750, // Set by ticket-price.handler in previous step
        confirmedRoute: {
          legs: [
            {
              from: 'Manchester Piccadilly',
              to: 'London Euston',
              departure: '12:00',
              arrival: '14:20',
              operator: 'Avanti West Coast',
              tripId: '202603071200001',
            },
          ],
        },
      },
    };

    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // AC-5 / AC-12: Valid class inputs — STANDARD
  // ---------------------------------------------------------------------------
  describe('AC-5 / AC-12: Valid input — STANDARD class', () => {
    it('should accept "STANDARD" and store "standard" in stateData', async () => {
      // AC-5: STANDARD (uppercase) accepted; stored lowercased
      mockContext.messageBody = 'STANDARD';
      const result = await ticketClassHandler(mockContext);

      // AC-9: ticket_class stored as lowercase
      expect(result.stateData).toBeDefined();
      expect(result.stateData!.ticket_class).toBe('standard');
    });

    it('should accept "standard" (lowercase)', async () => {
      // AC-5: Case-insensitive — lowercase accepted
      mockContext.messageBody = 'standard';
      const result = await ticketClassHandler(mockContext);

      expect(result.stateData!.ticket_class).toBe('standard');
    });

    it('should accept "Standard" (mixed case)', async () => {
      // AC-12: Case-insensitive — title case accepted
      mockContext.messageBody = 'Standard';
      const result = await ticketClassHandler(mockContext);

      expect(result.stateData!.ticket_class).toBe('standard');
    });

    it('should accept "STANDARD" with surrounding whitespace', async () => {
      // AC-12: Trim whitespace before parsing
      mockContext.messageBody = '  STANDARD  ';
      const result = await ticketClassHandler(mockContext);

      expect(result.stateData!.ticket_class).toBe('standard');
    });
  });

  // ---------------------------------------------------------------------------
  // AC-5 / AC-12: Valid class inputs — FIRST
  // ---------------------------------------------------------------------------
  describe('AC-5 / AC-12: Valid input — FIRST class', () => {
    it('should accept "FIRST" and store "first" in stateData', async () => {
      // AC-5: FIRST (uppercase) accepted; stored lowercased
      mockContext.messageBody = 'FIRST';
      const result = await ticketClassHandler(mockContext);

      expect(result.stateData!.ticket_class).toBe('first');
    });

    it('should accept "first" (lowercase)', async () => {
      // AC-5: Case-insensitive — lowercase accepted
      mockContext.messageBody = 'first';
      const result = await ticketClassHandler(mockContext);

      expect(result.stateData!.ticket_class).toBe('first');
    });

    it('should accept "First" (mixed case)', async () => {
      // AC-12: Case-insensitive — title case accepted
      mockContext.messageBody = 'First';
      const result = await ticketClassHandler(mockContext);

      expect(result.stateData!.ticket_class).toBe('first');
    });

    it('should accept "FIRST" with surrounding whitespace', async () => {
      // AC-12: Trim whitespace before parsing
      mockContext.messageBody = '  FIRST  ';
      const result = await ticketClassHandler(mockContext);

      expect(result.stateData!.ticket_class).toBe('first');
    });
  });

  // ---------------------------------------------------------------------------
  // AC-6: Success path — type prompt and state transition
  // ---------------------------------------------------------------------------
  describe('AC-6: Success path — type prompt and state transition', () => {
    it('should respond with ticket type prompt after valid STANDARD input', async () => {
      // AC-6: "What type of ticket did you buy? Reply: ADVANCE, ANYTIME, OFF-PEAK, or SUPER OFF-PEAK"
      mockContext.messageBody = 'STANDARD';
      const result = await ticketClassHandler(mockContext);

      expect(result.response).toContain('ADVANCE');
      expect(result.response).toContain('ANYTIME');
      expect(result.response).toContain('OFF-PEAK');
    });

    it('should respond with ticket type prompt after valid FIRST input', async () => {
      // AC-6: Same prompt regardless of which class was selected
      mockContext.messageBody = 'FIRST';
      const result = await ticketClassHandler(mockContext);

      expect(result.response).toContain('ADVANCE');
      expect(result.response).toContain('ANYTIME');
    });

    it('should transition to AWAITING_TICKET_TYPE after STANDARD', async () => {
      // AC-6: FSM transition to next state
      mockContext.messageBody = 'STANDARD';
      const result = await ticketClassHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_TYPE);
    });

    it('should transition to AWAITING_TICKET_TYPE after FIRST', async () => {
      // AC-6: FSM transition to next state
      mockContext.messageBody = 'FIRST';
      const result = await ticketClassHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_TYPE);
    });

    it('should preserve all existing stateData fields when storing ticket_class', async () => {
      // AC-9: ticket_class merged into stateData — previous fields not lost
      mockContext.messageBody = 'STANDARD';
      const result = await ticketClassHandler(mockContext);

      expect(result.stateData!.journeyId).toBe('journey-058-002');
      expect(result.stateData!.origin).toBe('MAN');
      expect(result.stateData!.destination).toBe('EUS');
      expect(result.stateData!.travelDate).toBe('2026-03-07');
      expect(result.stateData!.ticket_fare_pence).toBe(6750);
      expect(result.stateData!.ticket_class).toBe('standard');
    });
  });

  // ---------------------------------------------------------------------------
  // AC-5 / AC-12: Invalid input — error responses
  // ---------------------------------------------------------------------------
  describe('AC-5 / AC-12: Invalid input — error messages', () => {
    it('should return error message for unrecognised input', async () => {
      // AC-5: "Sorry, I didn't recognise that. Please reply STANDARD or FIRST"
      mockContext.messageBody = 'ECONOMY';
      const result = await ticketClassHandler(mockContext);

      expect(result.response).toContain('STANDARD');
      expect(result.response).toContain('FIRST');
    });

    it('should return error for "BUSINESS" (not a valid UK rail class)', async () => {
      // AC-12: Business class is not a valid UK rail ticket class
      mockContext.messageBody = 'BUSINESS';
      const result = await ticketClassHandler(mockContext);

      expect(result.response).toContain('STANDARD');
      expect(result.response).toContain('FIRST');
    });

    it('should return error for empty string input', async () => {
      // AC-12: Empty input
      mockContext.messageBody = '';
      const result = await ticketClassHandler(mockContext);

      expect(result.response).toContain('STANDARD');
      expect(result.response).toContain('FIRST');
    });

    it('should return error for numeric input', async () => {
      // AC-12: Numbers are not valid class selections
      mockContext.messageBody = '1';
      const result = await ticketClassHandler(mockContext);

      expect(result.response).toContain('STANDARD');
      expect(result.response).toContain('FIRST');
    });

    it('should return error for whitespace-only input', async () => {
      // AC-12: Whitespace only is not a valid selection
      mockContext.messageBody = '   ';
      const result = await ticketClassHandler(mockContext);

      expect(result.response).toContain('STANDARD');
      expect(result.response).toContain('FIRST');
    });

    it('should stay in AWAITING_TICKET_CLASS on invalid input', async () => {
      // AC-5: On error, remain in current state so user can retry
      mockContext.messageBody = 'ECONOMY';
      const result = await ticketClassHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_CLASS);
    });

    it('should NOT store ticket_class in stateData on invalid input', async () => {
      // AC-12: No state mutation on invalid input
      mockContext.messageBody = 'ECONOMY';
      const result = await ticketClassHandler(mockContext);

      expect(result.stateData?.ticket_class).toBeUndefined();
    });

    it('should NOT transition forward on invalid input', async () => {
      // AC-5: Invalid input must not advance to AWAITING_TICKET_TYPE
      mockContext.messageBody = 'BUSINESS';
      const result = await ticketClassHandler(mockContext);

      expect(result.nextState).not.toBe(FSMState.AWAITING_TICKET_TYPE);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-9: stateData integrity — ticket_class stored correctly
  // ---------------------------------------------------------------------------
  describe('AC-9: ticket_class stored as lowercase string', () => {
    it('should always store ticket_class as lowercase "standard" regardless of input case', async () => {
      // AC-9: Normalised value stored — not raw user input
      const inputs = ['STANDARD', 'standard', 'Standard', 'sTaNdArD'];
      for (const input of inputs) {
        mockContext.messageBody = input;
        const result = await ticketClassHandler(mockContext);
        expect(result.stateData!.ticket_class).toBe('standard');
      }
    });

    it('should always store ticket_class as lowercase "first" regardless of input case', async () => {
      // AC-9: Normalised value stored — not raw user input
      const inputs = ['FIRST', 'first', 'First', 'fIrSt'];
      for (const input of inputs) {
        mockContext.messageBody = input;
        const result = await ticketClassHandler(mockContext);
        expect(result.stateData!.ticket_class).toBe('first');
      }
    });
  });
});
