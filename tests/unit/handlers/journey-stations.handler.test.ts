/**
 * Journey Stations Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.6 Journey Stations Handler
 * Per ADR-014: These tests define the behavior
 *
 * Now includes CRS code lookup via mocked station.service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

// Mock station service
vi.mock('../../../src/services/station.service', () => ({
  searchStations: vi.fn().mockImplementation(async (query: string) => {
    // Return mock CRS codes for test station names
    const stationMap: Record<string, { crs: string; name: string }[]> = {
      'Kings Cross': [{ crs: 'KGX', name: 'London Kings Cross' }],
      'Edinburgh': [{ crs: 'EDB', name: 'Edinburgh Waverley' }],
      'Manchester': [{ crs: 'MAN', name: 'Manchester Piccadilly' }],
      'London': [{ crs: 'KGX', name: 'London Kings Cross' }],
      'Brighton': [{ crs: 'BTN', name: 'Brighton' }],
      'Victoria': [{ crs: 'VIC', name: 'London Victoria' }],
      'Abergavenny': [{ crs: 'AGV', name: 'Abergavenny' }],
      'Hereford': [{ crs: 'HFD', name: 'Hereford' }],
    };

    // Case-insensitive lookup
    const key = Object.keys(stationMap).find(
      (k) => k.toLowerCase() === query.toLowerCase()
    );
    return key ? stationMap[key] : [];
  }),
}));

// Import handler after mocks are set up
import { journeyStationsHandler } from '../../../src/handlers/journey-stations.handler';

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
      stateData: {
        travelDate: '2026-01-24',
        journeyId: 'test-journey-123',
      },
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

    it('should store CRS codes in state data', async () => {
      mockContext.messageBody = 'Kings Cross to Edinburgh';
      const result = await journeyStationsHandler(mockContext);
      expect(result.stateData).toBeDefined();
      expect(result.stateData?.origin).toBe('KGX'); // CRS code, not station name
      expect(result.stateData?.destination).toBe('EDB');
      expect(result.stateData?.originName).toBe('London Kings Cross'); // Display name
      expect(result.stateData?.destinationName).toBe('Edinburgh Waverley');
    });

    it('should preserve previous stateData fields', async () => {
      mockContext.messageBody = 'Kings Cross to Edinburgh';
      const result = await journeyStationsHandler(mockContext);
      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.journeyId).toBe('test-journey-123');
    });

    it('should handle "from X to Y" format', async () => {
      mockContext.messageBody = 'from Brighton to Victoria';
      const result = await journeyStationsHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
      expect(result.stateData?.origin).toBe('BTN');
      expect(result.stateData?.destination).toBe('VIC');
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

  describe('Station not found', () => {
    it('should return error when origin station not found', async () => {
      mockContext.messageBody = 'InvalidStation to Edinburgh';
      const result = await journeyStationsHandler(mockContext);
      expect(result.response).toContain('couldn\'t find');
      expect(result.response).toContain('InvalidStation');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_STATIONS);
    });

    it('should return error when destination station not found', async () => {
      mockContext.messageBody = 'Kings Cross to InvalidStation';
      const result = await journeyStationsHandler(mockContext);
      expect(result.response).toContain('couldn\'t find');
      expect(result.response).toContain('InvalidStation');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_STATIONS);
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
