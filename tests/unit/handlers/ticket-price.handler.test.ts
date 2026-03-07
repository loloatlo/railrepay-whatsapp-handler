/**
 * Ticket Price Handler Tests - TD-WHATSAPP-058: Manual Ticket Price Collection on SKIP
 *
 * TD CONTEXT: When user says SKIP at AWAITING_TICKET_UPLOAD, no ticket data is collected.
 * This handler collects ticket price in pence as the first step of the manual ticket flow.
 *
 * REQUIRED BEHAVIOR:
 *   - Parse price inputs (£45.50, 45.50, £45, 45) to integer pence
 *   - Reject invalid inputs with error message
 *   - SKIP input falls back to submitting without ticket data
 *   - Valid price stores ticket_fare_pence in stateData and transitions to AWAITING_TICKET_CLASS
 *
 * Phase TD-1: Test Specification (Jessie)
 * These tests MUST FAIL initially - no implementation exists yet.
 * Blake will implement src/handlers/ticket-price.handler.ts in Phase TD-2.
 *
 * Test Lock Rule: Blake MUST NOT modify these tests.
 * Per ADR-014 (TDD), per ADR-004 (Vitest).
 *
 * TRIGGER: Handler reached from AWAITING_TICKET_PRICE state
 *   (user said SKIP at ticket-upload, ticket-upload.handler transitions here - AC-2)
 * OUTPUT: Transitions to AWAITING_TICKET_CLASS on success (AC-4)
 *
 * Acceptance Criteria covered:
 * AC-3: ticket-price.handler parses price input (£45.50, 45.50, £45, 45) -> pence. Error for invalid.
 * AC-4: After valid price entry, responds with class prompt and transitions to AWAITING_TICKET_CLASS
 * AC-9: Collected ticket_fare_pence stored in stateData
 * AC-10: User can type SKIP at the price prompt to submit without ticket data
 * AC-11: Unit tests for price parsing (valid formats, invalid input, edge cases)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// AC-11: Infrastructure package mock (ADR-002 — Winston logger)
// Shared instance per guideline #11: single instance across all tests
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
// NOTE: This import will fail (RED) until Blake creates ticket-price.handler.ts
import { ticketPriceHandler } from '../../../src/handlers/ticket-price.handler';

describe('TD-WHATSAPP-058: ticket-price.handler', () => {
  let mockContext: HandlerContext;
  let mockUser: User;

  beforeEach(() => {
    mockUser = {
      id: 'user-058-price',
      phone_number: '+447700900058',
      verified_at: new Date('2026-01-10T10:00:00Z'),
      created_at: new Date('2026-01-10T10:00:00Z'),
      updated_at: new Date('2026-01-10T10:00:00Z'),
    };

    // stateData reflects journey data accumulated up to AWAITING_TICKET_PRICE
    // User previously said SKIP at ticket-upload, which transitioned here
    mockContext = {
      phoneNumber: '+447700900058',
      messageSid: 'SM058price',
      user: mockUser,
      currentState: FSMState.AWAITING_TICKET_PRICE,
      correlationId: 'test-corr-058-price',
      messageBody: '',
      stateData: {
        journeyId: 'journey-058-001',
        origin: 'PAD',
        destination: 'BRI',
        travelDate: '2026-03-07',
        confirmedRoute: {
          legs: [
            {
              from: 'London Paddington',
              to: 'Bristol Temple Meads',
              departure: '09:00',
              arrival: '10:30',
              operator: 'GWR',
              tripId: '202603070900001',
            },
          ],
        },
      },
    };

    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // AC-3 / AC-11: Valid price parsing — pence conversion
  // ---------------------------------------------------------------------------
  describe('AC-3 / AC-11: Price parsing — valid formats', () => {
    it('should parse "£45.50" to 4550 pence', async () => {
      // AC-3: "£45.50" is the canonical example in the spec
      mockContext.messageBody = '£45.50';
      const result = await ticketPriceHandler(mockContext);

      // AC-9: ticket_fare_pence stored in stateData
      expect(result.stateData).toBeDefined();
      expect(result.stateData!.ticket_fare_pence).toBe(4550);
    });

    it('should parse "45.50" (no £ symbol) to 4550 pence', async () => {
      // AC-3: Format without currency symbol
      mockContext.messageBody = '45.50';
      const result = await ticketPriceHandler(mockContext);

      expect(result.stateData!.ticket_fare_pence).toBe(4550);
    });

    it('should parse "£45" (whole pounds, with symbol) to 4500 pence', async () => {
      // AC-3: Whole-pound format with symbol
      mockContext.messageBody = '£45';
      const result = await ticketPriceHandler(mockContext);

      expect(result.stateData!.ticket_fare_pence).toBe(4500);
    });

    it('should parse "45" (whole pounds, no symbol) to 4500 pence', async () => {
      // AC-3: Whole-pound format without symbol
      mockContext.messageBody = '45';
      const result = await ticketPriceHandler(mockContext);

      expect(result.stateData!.ticket_fare_pence).toBe(4500);
    });

    it('should parse "£0" to 0 pence (valid zero-cost ticket)', async () => {
      // AC-11: Edge case — zero is valid (e.g., staff travel pass)
      mockContext.messageBody = '£0';
      const result = await ticketPriceHandler(mockContext);

      expect(result.stateData!.ticket_fare_pence).toBe(0);
      // Zero IS valid — should not return error
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_CLASS);
    });

    it('should parse "0" (zero without symbol) to 0 pence (valid)', async () => {
      // AC-11: Zero without symbol
      mockContext.messageBody = '0';
      const result = await ticketPriceHandler(mockContext);

      expect(result.stateData!.ticket_fare_pence).toBe(0);
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_CLASS);
    });

    it('should parse "£0.50" to 50 pence', async () => {
      // AC-11: Sub-pound amount
      mockContext.messageBody = '£0.50';
      const result = await ticketPriceHandler(mockContext);

      expect(result.stateData!.ticket_fare_pence).toBe(50);
    });

    it('should parse "100.00" to 10000 pence (triple digit)', async () => {
      // AC-11: Higher-value ticket
      mockContext.messageBody = '100.00';
      const result = await ticketPriceHandler(mockContext);

      expect(result.stateData!.ticket_fare_pence).toBe(10000);
    });

    it('should parse "£1.99" to 199 pence', async () => {
      // AC-11: Common odd-penny amount
      mockContext.messageBody = '£1.99';
      const result = await ticketPriceHandler(mockContext);

      expect(result.stateData!.ticket_fare_pence).toBe(199);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-4: Success path — response and state transition
  // ---------------------------------------------------------------------------
  describe('AC-4: Success path — class prompt and state transition', () => {
    it('should respond with class prompt after valid price input', async () => {
      // AC-4: "Was this a Standard or First Class ticket?"
      mockContext.messageBody = '£45.50';
      const result = await ticketPriceHandler(mockContext);

      expect(result.response).toContain('Standard');
      expect(result.response).toContain('First');
    });

    it('should transition to AWAITING_TICKET_CLASS after valid price input', async () => {
      // AC-4: FSM transition to next state
      mockContext.messageBody = '£45.50';
      const result = await ticketPriceHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_CLASS);
    });

    it('should preserve existing stateData fields when storing ticket_fare_pence', async () => {
      // AC-9: ticket_fare_pence merged with existing stateData (not replacing it)
      mockContext.messageBody = '£45.50';
      const result = await ticketPriceHandler(mockContext);

      expect(result.stateData!.journeyId).toBe('journey-058-001');
      expect(result.stateData!.origin).toBe('PAD');
      expect(result.stateData!.destination).toBe('BRI');
      expect(result.stateData!.travelDate).toBe('2026-03-07');
      expect(result.stateData!.ticket_fare_pence).toBe(4550);
    });

    it('should NOT transition to AWAITING_TICKET_CLASS on invalid input', async () => {
      // AC-3: Invalid input must not advance state
      mockContext.messageBody = 'fifty pounds';
      const result = await ticketPriceHandler(mockContext);

      expect(result.nextState).not.toBe(FSMState.AWAITING_TICKET_CLASS);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-3 / AC-11: Invalid input — error responses
  // ---------------------------------------------------------------------------
  describe('AC-3 / AC-11: Invalid input — error messages', () => {
    it('should return error message for non-numeric text', async () => {
      // AC-3: "Sorry, I couldn't understand that price..."
      mockContext.messageBody = 'fifty pounds';
      const result = await ticketPriceHandler(mockContext);

      expect(result.response).toContain('couldn\'t understand');
      expect(result.response).toContain('£45.50');
    });

    it('should return error for negative value', async () => {
      // AC-11: Negative price is invalid (cannot pay negative fare)
      mockContext.messageBody = '-£45.50';
      const result = await ticketPriceHandler(mockContext);

      expect(result.response).toContain('couldn\'t understand');
    });

    it('should return error for negative value without symbol', async () => {
      // AC-11: Negative without symbol
      mockContext.messageBody = '-45.50';
      const result = await ticketPriceHandler(mockContext);

      expect(result.response).toContain('couldn\'t understand');
    });

    it('should return error for empty string input', async () => {
      // AC-11: Empty string is not a valid price
      mockContext.messageBody = '';
      const result = await ticketPriceHandler(mockContext);

      expect(result.response).toContain('couldn\'t understand');
    });

    it('should return error for whitespace-only input', async () => {
      // AC-11: Whitespace is not a valid price
      mockContext.messageBody = '   ';
      const result = await ticketPriceHandler(mockContext);

      expect(result.response).toContain('couldn\'t understand');
    });

    it('should return error for "abc" (pure alphabetic)', async () => {
      // AC-11: Letters only — no numeric content
      mockContext.messageBody = 'abc';
      const result = await ticketPriceHandler(mockContext);

      expect(result.response).toContain('couldn\'t understand');
    });

    it('should return error for "£" alone (symbol without number)', async () => {
      // AC-11: Symbol with no numeric value
      mockContext.messageBody = '£';
      const result = await ticketPriceHandler(mockContext);

      expect(result.response).toContain('couldn\'t understand');
    });

    it('should stay in AWAITING_TICKET_PRICE state on invalid input', async () => {
      // AC-3: On error, remain in current state so user can retry
      mockContext.messageBody = 'not a price';
      const result = await ticketPriceHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_PRICE);
    });

    it('should NOT store ticket_fare_pence in stateData on invalid input', async () => {
      // AC-11: No state mutation on invalid input
      mockContext.messageBody = 'invalid';
      const result = await ticketPriceHandler(mockContext);

      expect(result.stateData?.ticket_fare_pence).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // AC-10: SKIP escape — submit journey without ticket data
  // ---------------------------------------------------------------------------
  describe('AC-10: SKIP at price prompt — fallback to no-ticket submission', () => {
    it('should accept "SKIP" and publish journey.created event', async () => {
      // AC-10: SKIP at price prompt calls createJourneyAndRespond without ticket data
      mockContext.messageBody = 'SKIP';
      const result = await ticketPriceHandler(mockContext);

      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents!.length).toBeGreaterThan(0);
      const event = result.publishEvents![0];
      expect(event.event_type).toBe('journey.created');
    });

    it('should accept "skip" (lowercase) as fallback', async () => {
      // AC-10: Case-insensitive SKIP
      mockContext.messageBody = 'skip';
      const result = await ticketPriceHandler(mockContext);

      expect(result.publishEvents).toBeDefined();
      const event = result.publishEvents![0];
      expect(event.event_type).toBe('journey.created');
    });

    it('should transition to AUTHENTICATED when user SKIPs price prompt', async () => {
      // AC-10: Journey submitted — return to main menu
      mockContext.messageBody = 'SKIP';
      const result = await ticketPriceHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should NOT include ticket_fare_pence in journey.created payload when SKIP', async () => {
      // AC-10: Fallback journey submitted without ticket data — no ticket fields in payload
      mockContext.messageBody = 'SKIP';
      const result = await ticketPriceHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.ticket_fare_pence).toBeUndefined();
      expect(event.payload.ticket_class).toBeUndefined();
      expect(event.payload.ticket_type).toBeUndefined();
    });

    it('should include journey data in payload when SKIP (passes through stateData)', async () => {
      // AC-10: Even when SKIPping ticket data, journey metadata is still in event
      mockContext.messageBody = 'SKIP';
      const result = await ticketPriceHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.journey_id).toBe('journey-058-001');
      expect(event.payload.origin_crs).toBe('PAD');
      expect(event.payload.destination_crs).toBe('BRI');
    });

    it('should respond with success message when SKIP', async () => {
      // AC-10: User receives journey submitted confirmation
      mockContext.messageBody = 'SKIP';
      const result = await ticketPriceHandler(mockContext);

      expect(result.response).toContain('submitted');
    });
  });

  // ---------------------------------------------------------------------------
  // AC-9: Outbox event payload includes ticket_fare_pence after full flow
  // ---------------------------------------------------------------------------
  describe('AC-9: ticket_fare_pence stored in stateData for downstream use', () => {
    it('should store ticket_fare_pence as integer (not float)', async () => {
      // AC-9: Must be integer pence — no floating point for money
      mockContext.messageBody = '£45.50';
      const result = await ticketPriceHandler(mockContext);

      expect(Number.isInteger(result.stateData!.ticket_fare_pence)).toBe(true);
      expect(result.stateData!.ticket_fare_pence).toBe(4550);
    });

    it('should store ticket_fare_pence as integer for whole pound amount', async () => {
      // AC-9: Whole pound also stored as integer pence
      mockContext.messageBody = '£45';
      const result = await ticketPriceHandler(mockContext);

      expect(Number.isInteger(result.stateData!.ticket_fare_pence)).toBe(true);
      expect(result.stateData!.ticket_fare_pence).toBe(4500);
    });
  });
});
