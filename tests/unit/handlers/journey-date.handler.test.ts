/**
 * Journey Date Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.5 Journey Date Handler
 * Per ADR-014: These tests define the behavior
 *
 * Test cases:
 * 1. Valid date (use date-parser) → Store in state, send JOURNEY_STATIONS, transition to AWAITING_JOURNEY_STATIONS
 * 2. Future date → Error message
 * 3. Date >90 days ago → Error message
 * 4. Invalid date → Send ERROR_INVALID_INPUT with hint
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { journeyDateHandler } from '../../../src/handlers/journey-date.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

describe('Journey Date Handler', () => {
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
      messageBody: 'yesterday',
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.AWAITING_JOURNEY_DATE,
      correlationId: 'test-corr-id',
    };
  });

  describe('Valid dates', () => {
    it('should accept "yesterday"', async () => {
      // Arrange
      mockContext.messageBody = 'yesterday';

      // Act
      const result = await journeyDateHandler(mockContext);

      // Assert
      expect(result.response).toContain('station');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_STATIONS);
    });

    it('should accept "today"', async () => {
      // Arrange
      mockContext.messageBody = 'today';

      // Act
      const result = await journeyDateHandler(mockContext);

      // Assert
      expect(result.response).toContain('station');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_STATIONS);
    });

    it('should store journey date in state data', async () => {
      // Arrange
      mockContext.messageBody = 'yesterday';

      // Act
      const result = await journeyDateHandler(mockContext);

      // Assert
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.travelDate).toBeDefined(); // Field renamed from journeyDate
      expect(result.stateData?.journeyId).toBeDefined();  // New: journeyId generated here
    });

    it('should accept date with month "15 Nov"', async () => {
      // Arrange
      mockContext.messageBody = '15 Nov';

      // Act
      const result = await journeyDateHandler(mockContext);

      // Assert
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_STATIONS);
    });

    it('should accept UK date format "15/11/2025"', async () => {
      // Arrange - Using a recent date within 90 days
      mockContext.messageBody = '15/11/2025';

      // Act
      const result = await journeyDateHandler(mockContext);

      // Assert
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_STATIONS);
    });
  });

  describe('Future dates', () => {
    it('should reject future dates', async () => {
      // Arrange
      mockContext.messageBody = 'tomorrow';

      // Act
      const result = await journeyDateHandler(mockContext);

      // Assert
      expect(result.response).toContain('future');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });
  });

  describe('Old dates (>90 days)', () => {
    it('should reject dates older than 90 days', async () => {
      // Arrange
      mockContext.messageBody = '2024-01-01';

      // Act
      const result = await journeyDateHandler(mockContext);

      // Assert
      expect(result.response).toContain('too old');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });
  });

  describe('Invalid input', () => {
    it('should reject invalid date format', async () => {
      // Arrange
      mockContext.messageBody = 'invalid';

      // Act
      const result = await journeyDateHandler(mockContext);

      // Assert
      expect(result.response).toContain('Invalid');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should provide helpful hint for invalid date', async () => {
      // Arrange
      mockContext.messageBody = 'xyz';

      // Act
      const result = await journeyDateHandler(mockContext);

      // Assert
      expect(result.response).toContain('today');
      expect(result.response).toContain('yesterday');
    });
  });
});
