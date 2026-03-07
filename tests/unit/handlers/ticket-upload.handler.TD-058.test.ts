/**
 * TD-WHATSAPP-058: ticket-upload.handler SKIP Path Change
 *
 * TD CONTEXT: Currently when user sends SKIP at AWAITING_TICKET_UPLOAD, the handler
 * immediately calls createJourneyAndRespond. After this TD, the SKIP path must instead
 * respond with a price prompt and transition to AWAITING_TICKET_PRICE so ticket data
 * can be collected conversationally.
 *
 * REQUIRED CHANGE to ticket-upload.handler.ts:
 *   BEFORE (current): SKIP -> createJourneyAndRespond(ctx, null) -> AUTHENTICATED
 *   AFTER (TD-058):   SKIP -> price prompt -> AWAITING_TICKET_PRICE
 *
 * NOTE ON EXISTING TESTS: The existing file ticket-upload.handler.test.ts contains
 * tests for the OLD SKIP behavior (SKIP -> AUTHENTICATED). Those tests will FAIL
 * after Blake's implementation (they test the old behavior). Blake should review
 * which old tests need updating — but Blake MUST NOT modify Jessie's test files.
 * The old SKIP tests are in the original test file and Blake must hand back to Jessie
 * if they conflict with this new specification.
 *
 * Phase TD-1: Test Specification (Jessie)
 * These tests MUST FAIL initially - no implementation change exists yet.
 * Blake will update ticket-upload.handler.ts SKIP path in Phase TD-2.
 *
 * Test Lock Rule: Blake MUST NOT modify these tests.
 * Per ADR-014 (TDD), per ADR-004 (Vitest).
 *
 * TRIGGER: AWAITING_TICKET_UPLOAD state + user sends SKIP
 * OUTPUT: Responds with price prompt, transitions to AWAITING_TICKET_PRICE (AC-2)
 *
 * Acceptance Criteria covered:
 * AC-2: When user sends SKIP at AWAITING_TICKET_UPLOAD, handler responds with price prompt
 *       and transitions to AWAITING_TICKET_PRICE
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ticketUploadHandler } from '../../../src/handlers/ticket-upload.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

describe('TD-WHATSAPP-058: ticket-upload.handler — SKIP path transitions to AWAITING_TICKET_PRICE', () => {
  let mockContext: HandlerContext;
  let mockUser: User;

  beforeEach(() => {
    mockUser = {
      id: 'user-058-upload',
      phone_number: '+447700900061',
      verified_at: new Date('2026-01-10T10:00:00Z'),
      created_at: new Date('2026-01-10T10:00:00Z'),
      updated_at: new Date('2026-01-10T10:00:00Z'),
    };

    // Full stateData accumulated through the journey flow before reaching ticket upload
    mockContext = {
      phoneNumber: '+447700900061',
      messageSid: 'SM058upload',
      user: mockUser,
      currentState: FSMState.AWAITING_TICKET_UPLOAD,
      correlationId: 'test-corr-058-upload',
      messageBody: 'SKIP',
      stateData: {
        journeyId: 'journey-058-004',
        origin: 'LIV',
        destination: 'MAN',
        travelDate: '2026-03-07',
        confirmedRoute: {
          legs: [
            {
              from: 'Liverpool Lime Street',
              to: 'Manchester Piccadilly',
              departure: '10:00',
              arrival: '10:55',
              operator: 'Avanti West Coast',
              tripId: '202603071000001',
            },
          ],
        },
        journeyConfirmed: true,
      },
    };
  });

  // ---------------------------------------------------------------------------
  // AC-2: SKIP at AWAITING_TICKET_UPLOAD → price prompt + AWAITING_TICKET_PRICE
  // ---------------------------------------------------------------------------
  describe('AC-2: SKIP transitions to AWAITING_TICKET_PRICE instead of submitting journey', () => {
    it('should respond with price prompt when user sends SKIP', async () => {
      // AC-2: "No problem! To help calculate your compensation, how much did your ticket cost? (e.g. GBP 45.50)"
      mockContext.messageBody = 'SKIP';
      const result = await ticketUploadHandler(mockContext);

      // Response must ask for ticket price
      expect(result.response).toMatch(/cost|price|paid|ticket/i);
      // Should mention an example like "45.50"
      expect(result.response).toMatch(/45\.50|£/);
    });

    it('should transition to AWAITING_TICKET_PRICE when user sends SKIP', async () => {
      // AC-2: Core assertion — SKIP no longer goes directly to AUTHENTICATED
      // This test MUST FAIL until Blake implements the new SKIP path
      mockContext.messageBody = 'SKIP';
      const result = await ticketUploadHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_PRICE);
    });

    it('should NOT submit journey.created event when user sends SKIP', async () => {
      // AC-2: Journey is NOT submitted yet — we need price/class/type first
      // This reverses the old behavior where SKIP triggered immediate submission
      mockContext.messageBody = 'SKIP';
      const result = await ticketUploadHandler(mockContext);

      const hasJourneyEvent = result.publishEvents?.some(e => e.event_type === 'journey.created');
      expect(hasJourneyEvent).toBeFalsy();
    });

    it('should NOT transition to AUTHENTICATED when user sends SKIP', async () => {
      // AC-2: Old behavior was SKIP -> AUTHENTICATED. New behavior is SKIP -> AWAITING_TICKET_PRICE.
      mockContext.messageBody = 'SKIP';
      const result = await ticketUploadHandler(mockContext);

      expect(result.nextState).not.toBe(FSMState.AUTHENTICATED);
    });

    it('should accept "skip" (lowercase) and transition to AWAITING_TICKET_PRICE', async () => {
      // AC-2: Case-insensitive SKIP
      mockContext.messageBody = 'skip';
      const result = await ticketUploadHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_PRICE);
    });

    it('should accept "Skip" (mixed case) and transition to AWAITING_TICKET_PRICE', async () => {
      // AC-2: Mixed case SKIP
      mockContext.messageBody = 'Skip';
      const result = await ticketUploadHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_PRICE);
    });

    it('should preserve stateData when transitioning to AWAITING_TICKET_PRICE', async () => {
      // AC-2: All journey data accumulated so far must survive the SKIP transition
      // ticket-price.handler will need journeyId, origin, destination etc from stateData
      mockContext.messageBody = 'SKIP';
      const result = await ticketUploadHandler(mockContext);

      expect(result.stateData).toBeDefined();
      expect(result.stateData!.journeyId).toBe('journey-058-004');
      expect(result.stateData!.origin).toBe('LIV');
      expect(result.stateData!.destination).toBe('MAN');
      expect(result.stateData!.travelDate).toBe('2026-03-07');
    });
  });

  // ---------------------------------------------------------------------------
  // Regression: media upload path is unchanged (AC-2 only modifies SKIP path)
  // ---------------------------------------------------------------------------
  describe('Media upload path — unchanged by TD-058', () => {
    it('should still accept media upload and transition to AUTHENTICATED (unchanged)', async () => {
      // Regression guard: media upload path must not be affected by SKIP path change
      mockContext.mediaUrl = 'https://api.twilio.com/media/abc123';
      mockContext.messageBody = '';
      const result = await ticketUploadHandler(mockContext);

      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
      expect(result.publishEvents?.some(e => e.event_type === 'journey.created')).toBe(true);
    });

    it('should NOT transition to AWAITING_TICKET_PRICE on media upload', async () => {
      // Regression: media path does not go through ticket collection flow
      mockContext.mediaUrl = 'https://api.twilio.com/media/abc123';
      mockContext.messageBody = '';
      const result = await ticketUploadHandler(mockContext);

      expect(result.nextState).not.toBe(FSMState.AWAITING_TICKET_PRICE);
    });
  });

  // ---------------------------------------------------------------------------
  // Regression: non-SKIP text with no media still prompts for photo (unchanged)
  // ---------------------------------------------------------------------------
  describe('No media, no SKIP — unchanged by TD-058', () => {
    it('should still prompt for photo when user sends non-SKIP text without media', async () => {
      // Regression guard: the "please send a photo" path is unchanged
      mockContext.messageBody = 'hello';
      mockContext.mediaUrl = undefined;
      const result = await ticketUploadHandler(mockContext);

      expect(result.response).toContain('photo');
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
    });
  });
});
