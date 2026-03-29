/**
 * Authenticated Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.4 Authenticated Handler
 * Per ADR-014: These tests define the behavior
 *
 * Test cases:
 * 1. "DELAY" or "delay" or "claim" → Send ticket-or-manual prompt, transition to AWAITING_TICKET_OR_MANUAL
 *    (BL-167 / TD-WHATSAPP-062-S1 AC-1: changed from AWAITING_JOURNEY_DATE to AWAITING_TICKET_OR_MANUAL)
 * 2. "STATUS" → Send status check message (placeholder for now)
 * 3. "HELP" → Send help menu
 * 4. "LOGOUT" → Delete state, send goodbye
 *
 * AC-1 UPDATE (BL-167): DELAY/CLAIM now transitions to AWAITING_TICKET_OR_MANUAL, not AWAITING_JOURNEY_DATE.
 * The old tests expected FSMState.AWAITING_JOURNEY_DATE — those assertions have been updated to
 * FSMState.AWAITING_TICKET_OR_MANUAL to reflect the new branching flow.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { authenticatedHandler } from '../../../src/handlers/authenticated.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

describe('Authenticated Handler', () => {
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
      messageBody: 'DELAY',
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.AUTHENTICATED,
      correlationId: 'test-corr-id',
    };
  });

  describe('Start delay claim flow', () => {
    it('should handle "DELAY" command', async () => {
      // AC-1 (BL-167): DELAY → AWAITING_TICKET_OR_MANUAL (not AWAITING_JOURNEY_DATE)
      // Prompt must mention photo/ticket option and MANUAL keyword
      mockContext.messageBody = 'DELAY';

      const result = await authenticatedHandler(mockContext);

      expect(result.response).toMatch(/photo|ticket|MANUAL/i);
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_OR_MANUAL);
    });

    it('should handle "delay" (lowercase)', async () => {
      // AC-1 (BL-167): Case-insensitive — lowercase "delay" also goes to AWAITING_TICKET_OR_MANUAL
      mockContext.messageBody = 'delay';

      const result = await authenticatedHandler(mockContext);

      expect(result.response).toMatch(/photo|ticket|MANUAL/i);
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_OR_MANUAL);
    });

    it('should handle "claim" as alias for DELAY', async () => {
      // AC-1 (BL-167): "claim" alias also routes to AWAITING_TICKET_OR_MANUAL
      mockContext.messageBody = 'claim';

      const result = await authenticatedHandler(mockContext);

      expect(result.response).toMatch(/photo|ticket|MANUAL/i);
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_OR_MANUAL);
    });

    it('should prompt the user to send a ticket photo or type MANUAL', async () => {
      // AC-1 (BL-167): Prompt text must convey both options:
      // "Send a photo of your ticket to get started quickly, or type MANUAL to enter your journey details."
      mockContext.messageBody = 'DELAY';

      const result = await authenticatedHandler(mockContext);

      expect(result.response).toContain('MANUAL');
      expect(result.response).toMatch(/photo|ticket/i);
    });
  });

  describe('Status check', () => {
    it('should handle "STATUS" command', async () => {
      // Arrange
      mockContext.messageBody = 'STATUS';

      // Act
      const result = await authenticatedHandler(mockContext);

      // Assert
      expect(result.response).toContain('status');
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should handle "status" (lowercase)', async () => {
      // Arrange
      mockContext.messageBody = 'status';

      // Act
      const result = await authenticatedHandler(mockContext);

      // Assert
      expect(result.response).toContain('status');
    });

    it('should provide placeholder message for MVP', async () => {
      // Arrange
      mockContext.messageBody = 'STATUS';

      // Act
      const result = await authenticatedHandler(mockContext);

      // Assert
      expect(result.response).toContain('claims');
    });
  });

  describe('Help menu', () => {
    it('should handle "HELP" command', async () => {
      // Arrange
      mockContext.messageBody = 'HELP';

      // Act
      const result = await authenticatedHandler(mockContext);

      // Assert
      expect(result.response).toContain('help');
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should handle "help" (lowercase)', async () => {
      // Arrange
      mockContext.messageBody = 'help';

      // Act
      const result = await authenticatedHandler(mockContext);

      // Assert
      expect(result.response).toContain('help');
    });

    it('should list available commands', async () => {
      // Arrange
      mockContext.messageBody = 'HELP';

      // Act
      const result = await authenticatedHandler(mockContext);

      // Assert
      expect(result.response).toContain('DELAY');
      expect(result.response).toContain('STATUS');
    });
  });

  describe('Logout', () => {
    it('should handle "LOGOUT" command', async () => {
      // Arrange
      mockContext.messageBody = 'LOGOUT';

      // Act
      const result = await authenticatedHandler(mockContext);

      // Assert
      expect(result.response).toContain('goodbye');
      expect(result.nextState).toBeUndefined();
    });

    it('should handle "logout" (lowercase)', async () => {
      // Arrange
      mockContext.messageBody = 'logout';

      // Act
      const result = await authenticatedHandler(mockContext);

      // Assert
      expect(result.response).toContain('goodbye');
      expect(result.nextState).toBeUndefined();
    });
  });

  describe('Invalid input', () => {
    it('should provide helpful error for unknown command', async () => {
      // Arrange
      mockContext.messageBody = 'UNKNOWN';

      // Act
      const result = await authenticatedHandler(mockContext);

      // Assert
      expect(result.response).toContain('didn\'t understand');
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should suggest valid commands', async () => {
      // Arrange
      mockContext.messageBody = 'xyz';

      // Act
      const result = await authenticatedHandler(mockContext);

      // Assert
      expect(result.response).toContain('DELAY');
      expect(result.response).toContain('STATUS');
      expect(result.response).toContain('HELP');
    });
  });
});
