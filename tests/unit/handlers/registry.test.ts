/**
 * Handler Registry Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 1. Handler Registry
 * Per ADR-014: These tests define the API contract
 *
 * Tests verify:
 * - Handler registration
 * - Handler retrieval by state
 * - Error handling for unregistered states
 * - Default handler functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getHandler, registerHandler, HandlerContext, HandlerResult } from '../../../src/handlers';
import { FSMState } from '../../../src/services/fsm.service';
import type { User } from '../../../src/db/types';

describe('Handler Registry', () => {
  describe('registerHandler', () => {
    it('should register a handler for a specific state', () => {
      // Arrange
      const mockHandler = vi.fn().mockResolvedValue({
        response: 'test response',
      });

      // Act
      registerHandler(FSMState.START, mockHandler);
      const retrievedHandler = getHandler(FSMState.START);

      // Assert
      expect(retrievedHandler).toBe(mockHandler);
    });

    it('should allow overwriting an existing handler', () => {
      // Arrange
      const firstHandler = vi.fn().mockResolvedValue({ response: 'first' });
      const secondHandler = vi.fn().mockResolvedValue({ response: 'second' });

      // Act
      registerHandler(FSMState.AWAITING_TERMS, firstHandler);
      registerHandler(FSMState.AWAITING_TERMS, secondHandler);
      const retrievedHandler = getHandler(FSMState.AWAITING_TERMS);

      // Assert
      expect(retrievedHandler).toBe(secondHandler);
      expect(retrievedHandler).not.toBe(firstHandler);
    });
  });

  describe('getHandler', () => {
    beforeEach(() => {
      // Clear any previously registered handlers
      // Note: This assumes we export a clearHandlers() function for testing
      // We'll implement that as needed
    });

    it('should retrieve a registered handler', () => {
      // Arrange
      const mockHandler = vi.fn().mockResolvedValue({
        response: 'registered handler',
      });
      registerHandler(FSMState.AUTHENTICATED, mockHandler);

      // Act
      const handler = getHandler(FSMState.AUTHENTICATED);

      // Assert
      expect(handler).toBe(mockHandler);
    });

    it('should throw error for unregistered state', () => {
      // Act & Assert
      expect(() => getHandler(FSMState.AWAITING_OTP)).toThrow(
        'No handler registered for state: AWAITING_OTP'
      );
    });

    it('should return different handlers for different states', () => {
      // Arrange
      const handler1 = vi.fn().mockResolvedValue({ response: 'handler 1' });
      const handler2 = vi.fn().mockResolvedValue({ response: 'handler 2' });
      registerHandler(FSMState.START, handler1);
      registerHandler(FSMState.AWAITING_TERMS, handler2);

      // Act
      const retrieved1 = getHandler(FSMState.START);
      const retrieved2 = getHandler(FSMState.AWAITING_TERMS);

      // Assert
      expect(retrieved1).toBe(handler1);
      expect(retrieved2).toBe(handler2);
      expect(retrieved1).not.toBe(retrieved2);
    });
  });

  describe('HandlerContext interface', () => {
    it('should define correct HandlerContext shape', () => {
      // This test verifies the TypeScript interface is correct
      const context: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'test message',
        messageSid: 'SM123',
        user: null,
        currentState: FSMState.START,
        correlationId: 'corr-123',
      };

      expect(context.phoneNumber).toBe('+447700900123');
      expect(context.user).toBeNull();
    });

    it('should allow optional mediaUrl in HandlerContext', () => {
      const context: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'test',
        messageSid: 'SM123',
        mediaUrl: 'https://example.com/image.jpg',
        user: null,
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'corr-123',
      };

      expect(context.mediaUrl).toBe('https://example.com/image.jpg');
    });

    it('should include User object when available', () => {
      const user: User = {
        id: 'user-123',
        phone_number: '+447700900123',
        verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const context: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'test',
        messageSid: 'SM123',
        user,
        currentState: FSMState.AUTHENTICATED,
        correlationId: 'corr-123',
      };

      expect(context.user).toBe(user);
      expect(context.user?.verified_at).toBeInstanceOf(Date);
    });
  });

  describe('HandlerResult interface', () => {
    it('should define correct HandlerResult shape with only response', () => {
      const result: HandlerResult = {
        response: 'Hello user',
      };

      expect(result.response).toBe('Hello user');
      expect(result.nextState).toBeUndefined();
      expect(result.stateData).toBeUndefined();
    });

    it('should allow nextState and stateData', () => {
      const result: HandlerResult = {
        response: 'Please enter your OTP',
        nextState: FSMState.AWAITING_OTP,
        stateData: { verificationSid: 'VE123' },
      };

      expect(result.nextState).toBe(FSMState.AWAITING_OTP);
      expect(result.stateData?.verificationSid).toBe('VE123');
    });

    it('should allow publishEvents array', () => {
      const result: HandlerResult = {
        response: 'User registered',
        publishEvents: [
          {
            id: 'evt-123',
            aggregate_id: 'user-123',
            aggregate_type: 'user',
            event_type: 'user.registered',
            payload: { phone_number: '+447700900123' },
            published_at: null,
            created_at: new Date(),
          },
        ],
      };

      expect(result.publishEvents).toHaveLength(1);
      expect(result.publishEvents?.[0].event_type).toBe('user.registered');
    });
  });
});
