/**
 * Journey Stations Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.6 Journey Stations Handler
 * Per ADR-014: These tests define the behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { journeyStationsHandler } from '../../../src/handlers/journey-stations.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

describe('Journey Stations Handler', () => {
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
      messageBody: 'Kings Cross to Edinburgh',
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.AWAITING_JOURNEY_STATIONS,
      correlationId: 'test-corr-id',
    };
  });

  describe('Valid station pairs', () => {
    it('should parse "Kings Cross to Edinburgh"', async () => {
      mockContext.messageBody = 'Kings Cross to Edinburgh';
      const result = await journeyStationsHandler(mockContext);
      expect(result.response).toContain('time');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should parse "Manchester to London"', async () => {
      mockContext.messageBody = 'Manchester to London';
      const result = await journeyStationsHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should store stations in state data', async () => {
      mockContext.messageBody = 'Kings Cross to Edinburgh';
      const result = await journeyStationsHandler(mockContext);
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.originStation).toBeDefined();
      expect(result.stateData?.destinationStation).toBeDefined();
    });

    it('should handle "from X to Y" format', async () => {
      mockContext.messageBody = 'from Brighton to Victoria';
      const result = await journeyStationsHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });
  });

  describe('Ambiguous stations', () => {
    it('should handle ambiguous station with multiple matches (MVP: accept first match)', async () => {
      mockContext.messageBody = 'London to Manchester';
      const result = await journeyStationsHandler(mockContext);
      // For MVP, we accept first match
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });
  });

  describe('Invalid input', () => {
    it('should reject invalid format (no "to")', async () => {
      mockContext.messageBody = 'Kings Cross Edinburgh';
      const result = await journeyStationsHandler(mockContext);
      expect(result.response).toContain('Invalid');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_STATIONS);
    });

    it('should provide helpful hint', async () => {
      mockContext.messageBody = 'invalid';
      const result = await journeyStationsHandler(mockContext);
      expect(result.response).toContain('to');
      expect(result.response).toContain('Kings Cross to Edinburgh');
    });

    it('should reject empty origin', async () => {
      mockContext.messageBody = 'to Edinburgh';
      const result = await journeyStationsHandler(mockContext);
      expect(result.response).toContain('Invalid');
    });

    it('should reject empty destination', async () => {
      mockContext.messageBody = 'Kings Cross to';
      const result = await journeyStationsHandler(mockContext);
      expect(result.response).toContain('Invalid');
    });
  });
});
