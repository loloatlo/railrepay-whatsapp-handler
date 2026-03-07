/**
 * Ticket Type Handler Tests - TD-WHATSAPP-058: Manual Ticket Type Collection
 *
 * TD CONTEXT: Third and final step of manual ticket flow. After the user provides price
 * and class, this handler collects the ticket type (Advance/Anytime/Off-Peak/Super Off-Peak).
 * After a valid type, the journey is submitted via the outbox.
 *
 * REQUIRED BEHAVIOR:
 *   - Accept ADVANCE, ANYTIME, OFF-PEAK, SUPER OFF-PEAK (case-insensitive)
 *   - Reject invalid input with error message
 *   - Store ticket_type in stateData (lowercased)
 *   - After valid type, call createJourneyAndRespond with full ticket data from stateData
 *   - journey.created payload includes ticket_fare_pence, ticket_class, ticket_type
 *
 * Phase TD-1: Test Specification (Jessie)
 * These tests MUST FAIL initially - no implementation exists yet.
 * Blake will implement src/handlers/ticket-type.handler.ts in Phase TD-2.
 *
 * Test Lock Rule: Blake MUST NOT modify these tests.
 * Per ADR-014 (TDD), per ADR-004 (Vitest).
 *
 * TRIGGER: Handler reached from AWAITING_TICKET_TYPE state
 *   (ticket-class.handler transitions here after valid class entry - AC-6)
 * OUTPUT: Calls createJourneyAndRespond — transitions to AUTHENTICATED (AC-8)
 *
 * Acceptance Criteria covered:
 * AC-7: ticket-type.handler accepts ADVANCE/ANYTIME/OFF-PEAK/SUPER OFF-PEAK. Error for invalid.
 * AC-8: After valid type entry, transitions to journey submission (AUTHENTICATED)
 * AC-9: ticket_type stored in stateData AND included in journey.created outbox event payload
 *       alongside ticket_fare_pence and ticket_class
 * AC-13: Unit tests for type selection (all valid values, case variants, invalid input)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// AC-13: Infrastructure package mock (ADR-002 — Winston logger)
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
// NOTE: This import will fail (RED) until Blake creates ticket-type.handler.ts
import { ticketTypeHandler } from '../../../src/handlers/ticket-type.handler';

describe('TD-WHATSAPP-058: ticket-type.handler', () => {
  let mockContext: HandlerContext;
  let mockUser: User;

  beforeEach(() => {
    mockUser = {
      id: 'user-058-type',
      phone_number: '+447700900060',
      verified_at: new Date('2026-01-10T10:00:00Z'),
      created_at: new Date('2026-01-10T10:00:00Z'),
      updated_at: new Date('2026-01-10T10:00:00Z'),
    };

    // stateData has journey data + ticket_fare_pence + ticket_class from previous steps
    mockContext = {
      phoneNumber: '+447700900060',
      messageSid: 'SM058type',
      user: mockUser,
      currentState: FSMState.AWAITING_TICKET_TYPE,
      correlationId: 'test-corr-058-type',
      messageBody: '',
      stateData: {
        journeyId: 'journey-058-003',
        origin: 'KGX',
        destination: 'YRK',
        travelDate: '2026-03-07',
        ticket_fare_pence: 8900,   // Set by ticket-price.handler
        ticket_class: 'standard', // Set by ticket-class.handler
        confirmedRoute: {
          legs: [
            {
              from: 'London Kings Cross',
              to: 'York',
              departure: '11:00',
              arrival: '13:00',
              operator: 'LNER',
              tripId: '202603071100001',
            },
          ],
        },
      },
    };

    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // AC-7 / AC-13: Valid type inputs — all four accepted types
  // ---------------------------------------------------------------------------
  describe('AC-7 / AC-13: Valid input — ADVANCE', () => {
    it('should accept "ADVANCE" and store "advance" in stateData', async () => {
      // AC-7: ADVANCE (uppercase) accepted; stored lowercased
      mockContext.messageBody = 'ADVANCE';
      const result = await ticketTypeHandler(mockContext);

      // AC-9: ticket_type stored (verified via event payload — handler calls createJourneyAndRespond)
      expect(result.publishEvents).toBeDefined();
      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('advance');
    });

    it('should accept "advance" (lowercase)', async () => {
      // AC-7: Case-insensitive
      mockContext.messageBody = 'advance';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('advance');
    });

    it('should accept "Advance" (mixed case)', async () => {
      // AC-13: Title case accepted
      mockContext.messageBody = 'Advance';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('advance');
    });
  });

  describe('AC-7 / AC-13: Valid input — ANYTIME', () => {
    it('should accept "ANYTIME" and store "anytime" in event payload', async () => {
      // AC-7: ANYTIME accepted
      mockContext.messageBody = 'ANYTIME';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('anytime');
    });

    it('should accept "anytime" (lowercase)', async () => {
      // AC-7: Case-insensitive
      mockContext.messageBody = 'anytime';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('anytime');
    });

    it('should accept "Anytime" (mixed case)', async () => {
      // AC-13: Mixed case accepted
      mockContext.messageBody = 'Anytime';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('anytime');
    });
  });

  describe('AC-7 / AC-13: Valid input — OFF-PEAK', () => {
    it('should accept "OFF-PEAK" and store "off-peak" in event payload', async () => {
      // AC-7: OFF-PEAK (with hyphen, uppercase) accepted
      mockContext.messageBody = 'OFF-PEAK';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('off-peak');
    });

    it('should accept "off-peak" (lowercase)', async () => {
      // AC-7: Case-insensitive
      mockContext.messageBody = 'off-peak';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('off-peak');
    });

    it('should accept "Off-Peak" (mixed case)', async () => {
      // AC-13: Title case accepted
      mockContext.messageBody = 'Off-Peak';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('off-peak');
    });
  });

  describe('AC-7 / AC-13: Valid input — SUPER OFF-PEAK', () => {
    it('should accept "SUPER OFF-PEAK" and store "super off-peak" in event payload', async () => {
      // AC-7: Multi-word type with hyphen accepted
      mockContext.messageBody = 'SUPER OFF-PEAK';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('super off-peak');
    });

    it('should accept "super off-peak" (lowercase)', async () => {
      // AC-7: Case-insensitive
      mockContext.messageBody = 'super off-peak';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('super off-peak');
    });

    it('should accept "Super Off-Peak" (mixed case)', async () => {
      // AC-13: Mixed case accepted
      mockContext.messageBody = 'Super Off-Peak';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('super off-peak');
    });
  });

  // ---------------------------------------------------------------------------
  // AC-8: Success path — journey submission and state transition
  // ---------------------------------------------------------------------------
  describe('AC-8: Success path — journey submitted and transition to AUTHENTICATED', () => {
    it('should transition to AUTHENTICATED after valid type input', async () => {
      // AC-8: createJourneyAndRespond transitions user back to main menu
      mockContext.messageBody = 'ADVANCE';
      const result = await ticketTypeHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should publish journey.created event after valid type input', async () => {
      // AC-8: Journey submission occurs via outbox
      mockContext.messageBody = 'ADVANCE';
      const result = await ticketTypeHandler(mockContext);

      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents!.length).toBeGreaterThan(0);
      expect(result.publishEvents![0].event_type).toBe('journey.created');
    });

    it('should respond with journey submitted confirmation', async () => {
      // AC-8: User receives confirmation that journey was submitted
      mockContext.messageBody = 'ADVANCE';
      const result = await ticketTypeHandler(mockContext);

      expect(result.response).toContain('submitted');
    });
  });

  // ---------------------------------------------------------------------------
  // AC-9: Full ticket data in journey.created outbox event payload
  // ---------------------------------------------------------------------------
  describe('AC-9: journey.created payload includes complete ticket data', () => {
    it('should include ticket_fare_pence in journey.created payload', async () => {
      // AC-9: ticket_fare_pence from stateData in outbox event
      mockContext.messageBody = 'ADVANCE';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_fare_pence).toBe(8900);
    });

    it('should include ticket_class in journey.created payload', async () => {
      // AC-9: ticket_class from stateData in outbox event
      mockContext.messageBody = 'ADVANCE';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_class).toBe('standard');
    });

    it('should include ticket_type in journey.created payload', async () => {
      // AC-9: ticket_type (just stored) in outbox event
      mockContext.messageBody = 'ADVANCE';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('advance');
    });

    it('should include all three ticket fields together in payload', async () => {
      // AC-9: All three ticket fields present simultaneously in a single event
      mockContext.messageBody = 'OFF-PEAK';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      // All three must be present — eligibility-engine needs all three to calculate compensation
      expect(event.payload).toHaveProperty('ticket_fare_pence', 8900);
      expect(event.payload).toHaveProperty('ticket_class', 'standard');
      expect(event.payload).toHaveProperty('ticket_type', 'off-peak');
    });

    it('should include ticket fields alongside existing journey metadata in payload', async () => {
      // AC-9: Ticket fields do not replace journey data — both coexist
      mockContext.messageBody = 'ANYTIME';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      // Journey metadata from stateData must still be present
      expect(event.payload.journey_id).toBe('journey-058-003');
      expect(event.payload.origin_crs).toBe('KGX');
      expect(event.payload.destination_crs).toBe('YRK');
      // Ticket fields also present
      expect(event.payload.ticket_fare_pence).toBe(8900);
      expect(event.payload.ticket_class).toBe('standard');
      expect(event.payload.ticket_type).toBe('anytime');
    });

    it('should include ticket_class "first" when first class was selected', async () => {
      // AC-9: Ensure ticket_class value is read from stateData (not hardcoded)
      mockContext.stateData!.ticket_class = 'first';
      mockContext.messageBody = 'ADVANCE';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_class).toBe('first');
    });

    it('should use ticket_fare_pence from stateData verbatim', async () => {
      // AC-9: Verify ticket_fare_pence is not re-calculated by this handler
      mockContext.stateData!.ticket_fare_pence = 12300; // Different value from setup
      mockContext.messageBody = 'ANYTIME';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_fare_pence).toBe(12300);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-7 / AC-13: Invalid input — error responses
  // ---------------------------------------------------------------------------
  describe('AC-7 / AC-13: Invalid input — error messages', () => {
    it('should return error message for unrecognised type', async () => {
      // AC-7: "Sorry, I didn't recognise that ticket type. Please reply: ADVANCE, ANYTIME, OFF-PEAK, or SUPER OFF-PEAK"
      mockContext.messageBody = 'FLEXIBLE';
      const result = await ticketTypeHandler(mockContext);

      expect(result.response).toContain('ADVANCE');
      expect(result.response).toContain('ANYTIME');
      expect(result.response).toContain('OFF-PEAK');
      expect(result.response).toContain('SUPER OFF-PEAK');
    });

    it('should return error for "SEASON" (not a valid Delay Repay type)', async () => {
      // AC-13: Season tickets are not in the valid set
      mockContext.messageBody = 'SEASON';
      const result = await ticketTypeHandler(mockContext);

      expect(result.response).toContain('ADVANCE');
    });

    it('should return error for empty string input', async () => {
      // AC-13: Empty input
      mockContext.messageBody = '';
      const result = await ticketTypeHandler(mockContext);

      expect(result.response).toContain('ADVANCE');
    });

    it('should return error for whitespace-only input', async () => {
      // AC-13: Whitespace only
      mockContext.messageBody = '   ';
      const result = await ticketTypeHandler(mockContext);

      expect(result.response).toContain('ADVANCE');
    });

    it('should return error for numeric input', async () => {
      // AC-13: Numbers are not valid type selections
      mockContext.messageBody = '3';
      const result = await ticketTypeHandler(mockContext);

      expect(result.response).toContain('ADVANCE');
    });

    it('should stay in AWAITING_TICKET_TYPE on invalid input', async () => {
      // AC-7: On error, remain in current state so user can retry
      mockContext.messageBody = 'FLEXIBLE';
      const result = await ticketTypeHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_TYPE);
    });

    it('should NOT publish journey.created event on invalid input', async () => {
      // AC-7: Journey must not be submitted if type is invalid
      mockContext.messageBody = 'FLEXIBLE';
      const result = await ticketTypeHandler(mockContext);

      // Either no events, or events list is empty
      const hasJourneyEvent = result.publishEvents?.some(e => e.event_type === 'journey.created');
      expect(hasJourneyEvent).toBeFalsy();
    });

    it('should NOT transition to AUTHENTICATED on invalid input', async () => {
      // AC-7: Journey submission must not occur on invalid type
      mockContext.messageBody = 'SEASON';
      const result = await ticketTypeHandler(mockContext);

      expect(result.nextState).not.toBe(FSMState.AUTHENTICATED);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-13: Edge case — input trimming
  // ---------------------------------------------------------------------------
  describe('AC-13: Edge cases — whitespace trimming', () => {
    it('should accept "ADVANCE" with surrounding whitespace', async () => {
      // AC-13: Trim whitespace before parsing
      mockContext.messageBody = '  ADVANCE  ';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('advance');
    });

    it('should accept "SUPER OFF-PEAK" with surrounding whitespace', async () => {
      // AC-13: Multi-word type with whitespace trimming
      mockContext.messageBody = '  SUPER OFF-PEAK  ';
      const result = await ticketTypeHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_type).toBe('super off-peak');
    });
  });
});
