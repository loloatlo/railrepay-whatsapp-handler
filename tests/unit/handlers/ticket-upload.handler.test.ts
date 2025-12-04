/**
 * Ticket Upload Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.9 Ticket Upload Handler
 * Per ADR-014: These tests define the behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ticketUploadHandler } from '../../../src/handlers/ticket-upload.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

describe('Ticket Upload Handler', () => {
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
      messageBody: '',
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.AWAITING_TICKET_UPLOAD,
      correlationId: 'test-corr-id',
    };
  });

  describe('Media upload', () => {
    it('should accept media upload with MediaUrl0', async () => {
      mockContext.mediaUrl = 'https://api.twilio.com/media/123';
      const result = await ticketUploadHandler(mockContext);
      expect(result.response).toContain('success');
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should store ticket URL in state data', async () => {
      mockContext.mediaUrl = 'https://api.twilio.com/media/123';
      const result = await ticketUploadHandler(mockContext);
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.ticketUrl).toBe('https://api.twilio.com/media/123');
    });

    it('should publish journey.created event', async () => {
      mockContext.mediaUrl = 'https://api.twilio.com/media/123';
      const result = await ticketUploadHandler(mockContext);
      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents?.length).toBeGreaterThan(0);
      const event = result.publishEvents![0];
      expect(event.event_type).toBe('journey.created');
    });
  });

  describe('No media provided', () => {
    it('should prompt user when no media', async () => {
      mockContext.mediaUrl = undefined;
      mockContext.messageBody = 'no media';
      const result = await ticketUploadHandler(mockContext);
      expect(result.response).toContain('photo');
      expect(result.nextState).toBe(FSMState.AWAITING_TICKET_UPLOAD);
    });
  });

  describe('Skip option (MVP)', () => {
    it('should allow "SKIP" for MVP', async () => {
      mockContext.messageBody = 'SKIP';
      const result = await ticketUploadHandler(mockContext);
      expect(result.response).toContain('success');
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should accept "skip" (lowercase)', async () => {
      mockContext.messageBody = 'skip';
      const result = await ticketUploadHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AUTHENTICATED);
    });

    it('should publish event even without ticket', async () => {
      mockContext.messageBody = 'SKIP';
      const result = await ticketUploadHandler(mockContext);
      expect(result.publishEvents).toBeDefined();
      const event = result.publishEvents![0];
      expect(event.event_type).toBe('journey.created');
    });
  });
});
