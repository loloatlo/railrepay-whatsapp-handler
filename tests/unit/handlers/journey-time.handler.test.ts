/**
 * Journey Time Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 2.7 Journey Time Handler
 * Per ADR-014: These tests define the behavior
 *
 * Now includes journey-matcher API call to find real routes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';
import axios from 'axios';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// Mock winston logger
vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import handler after mocks
import { journeyTimeHandler } from '../../../src/handlers/journey-time.handler';

describe('Journey Time Handler', () => {
  let mockContext: HandlerContext;
  let mockUser: User;

  beforeEach(() => {
    // Set required environment variable
    process.env.JOURNEY_MATCHER_URL = 'http://journey-matcher:8080';

    mockUser = {
      id: 'user-123',
      phone_number: '+447700900123',
      verified_at: new Date('2024-11-20T10:00:00Z'),
      created_at: new Date('2024-11-20T10:00:00Z'),
      updated_at: new Date('2024-11-20T10:00:00Z'),
    };

    mockContext = {
      phoneNumber: '+447700900123',
      messageBody: '14:30',
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.AWAITING_JOURNEY_TIME,
      correlationId: 'test-corr-id',
      stateData: {
        travelDate: '2026-01-24',
        journeyId: 'test-journey-123',
        origin: 'AGV',
        destination: 'HFD',
        originName: 'Abergavenny',
        destinationName: 'Hereford',
      },
    };

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.JOURNEY_MATCHER_URL;
  });

  describe('Valid times with API call', () => {
    it('should accept 24-hour format "14:30" and call journey-matcher', async () => {
      // Mock direct route response
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          routes: [
            {
              legs: [
                {
                  from: 'Abergavenny',
                  to: 'Hereford',
                  departure: '14:31',
                  arrival: '15:00',
                  operator: 'Transport for Wales',
                },
              ],
              totalDuration: '29m',
              isDirect: true,
            },
          ],
        },
      });

      mockContext.messageBody = '14:30';
      const result = await journeyTimeHandler(mockContext);

      expect(result.response).toContain('14:31');
      expect(result.response).toContain('Abergavenny');
      expect(result.response).toContain('YES');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://journey-matcher:8080/routes',
        expect.objectContaining({
          params: {
            from: 'AGV',
            to: 'HFD',
            date: '2026-01-24',
            time: '14:30',
          },
        })
      );
    });

    it('should accept 12-hour format "2:30pm"', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          routes: [
            {
              legs: [{ from: 'A', to: 'B', departure: '14:31', arrival: '15:00', operator: 'TfW' }],
              totalDuration: '29m',
              isDirect: true,
            },
          ],
        },
      });

      mockContext.messageBody = '2:30pm';
      const result = await journeyTimeHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should accept compact format "1430"', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          routes: [
            {
              legs: [{ from: 'A', to: 'B', departure: '14:31', arrival: '15:00', operator: 'TfW' }],
              totalDuration: '29m',
              isDirect: true,
            },
          ],
        },
      });

      mockContext.messageBody = '1430';
      const result = await journeyTimeHandler(mockContext);
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
    });

    it('should store departureTime and matchedRoute in state data', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          routes: [
            {
              legs: [{ from: 'A', to: 'B', departure: '14:31', arrival: '15:00', operator: 'TfW' }],
              totalDuration: '29m',
              isDirect: true,
            },
          ],
        },
      });

      mockContext.messageBody = '14:30';
      const result = await journeyTimeHandler(mockContext);

      expect(result.stateData).toBeDefined();
      expect(result.stateData?.departureTime).toBe('14:30');
      expect(result.stateData?.matchedRoute).toBeDefined();
      expect(result.stateData?.isDirect).toBe(true);
    });

    it('should store ALL routes in stateData.allRoutes for routing-alternative.handler (was: storing only routes[0]) - AC-1', async () => {
      /**
       * TD-WHATSAPP-054 AC-1: journey-time.handler must store ALL routes from API response
       * This provides routing-alternative.handler with Set 1 alternatives (indices 1, 2, 3)
       */
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          routes: [
            {
              legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '08:31', arrival: '09:00' }],
              totalDuration: '29m',
              isDirect: true,
            },
            {
              legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '09:31', arrival: '10:00' }],
              totalDuration: '29m',
              isDirect: true,
            },
            {
              legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '10:31', arrival: '11:00' }],
              totalDuration: '29m',
              isDirect: true,
            },
            {
              legs: [{ from: 'AGV', to: 'HFD', operator: 'TfW', departure: '11:31', arrival: '12:00' }],
              totalDuration: '29m',
              isDirect: true,
            },
          ],
        },
      });

      mockContext.messageBody = '08:30';
      const result = await journeyTimeHandler(mockContext);

      // Assert: stateData includes allRoutes array
      expect(result.stateData?.allRoutes).toBeDefined();
      expect(Array.isArray(result.stateData?.allRoutes)).toBe(true);
      expect(result.stateData?.allRoutes).toHaveLength(4);

      // Assert: allRoutes contains all routes, not just the first one
      expect(result.stateData?.allRoutes[0].legs[0].departure).toBe('08:31');
      expect(result.stateData?.allRoutes[1].legs[0].departure).toBe('09:31');
      expect(result.stateData?.allRoutes[2].legs[0].departure).toBe('10:31');
      expect(result.stateData?.allRoutes[3].legs[0].departure).toBe('11:31');
    });

    it('should preserve previous stateData fields', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          routes: [
            {
              legs: [{ from: 'A', to: 'B', departure: '14:31', arrival: '15:00', operator: 'TfW' }],
              isDirect: true,
            },
          ],
        },
      });

      mockContext.messageBody = '14:30';
      const result = await journeyTimeHandler(mockContext);

      expect(result.stateData?.travelDate).toBe('2026-01-24');
      expect(result.stateData?.journeyId).toBe('test-journey-123');
      expect(result.stateData?.origin).toBe('AGV');
    });
  });

  describe('Interchange routes', () => {
    it('should handle interchange route with multiple legs', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          routes: [
            {
              legs: [
                { from: 'Abergavenny', to: 'Hereford', departure: '08:31', arrival: '09:00', operator: 'TfW' },
                { from: 'Hereford', to: 'Birmingham', departure: '09:40', arrival: '10:30', operator: 'TfW' },
              ],
              totalDuration: '1h 59m',
              isDirect: false,
              interchangeStation: 'Hereford',
            },
          ],
        },
      });

      mockContext.messageBody = '08:30';
      mockContext.stateData = {
        ...mockContext.stateData,
        destination: 'BHM',
        destinationName: 'Birmingham New Street',
      };

      const result = await journeyTimeHandler(mockContext);

      expect(result.response).toContain('change at Hereford');
      expect(result.response).toContain('Leg 1');
      expect(result.response).toContain('Leg 2');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_CONFIRM);
      expect(result.stateData?.isDirect).toBe(false);
      expect(result.stateData?.interchangeStation).toBe('Hereford');
    });

    it('should store allRoutes in stateData for interchange journeys (AC-1)', async () => {
      /**
       * TD-WHATSAPP-054 AC-1: Interchange routes also need allRoutes stored
       */
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          routes: [
            {
              legs: [
                { from: 'Abergavenny', to: 'Hereford', departure: '08:31', arrival: '09:00', operator: 'TfW' },
                { from: 'Hereford', to: 'Birmingham', departure: '09:40', arrival: '10:30', operator: 'TfW' },
              ],
              totalDuration: '1h 59m',
              isDirect: false,
            },
            {
              legs: [
                { from: 'Abergavenny', to: 'Hereford', departure: '10:31', arrival: '11:00', operator: 'TfW' },
                { from: 'Hereford', to: 'Birmingham', departure: '11:40', arrival: '12:30', operator: 'TfW' },
              ],
              totalDuration: '1h 59m',
              isDirect: false,
            },
          ],
        },
      });

      mockContext.messageBody = '08:30';
      mockContext.stateData = {
        ...mockContext.stateData,
        destination: 'BHM',
        destinationName: 'Birmingham New Street',
      };

      const result = await journeyTimeHandler(mockContext);

      // Assert: allRoutes array stored
      expect(result.stateData?.allRoutes).toBeDefined();
      expect(result.stateData?.allRoutes).toHaveLength(2);
      expect(result.stateData?.allRoutes[0].isDirect).toBe(false);
      expect(result.stateData?.allRoutes[1].isDirect).toBe(false);
    });
  });

  describe('API error handling', () => {
    it('should return error when no routes found', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { routes: [] },
      });

      mockContext.messageBody = '14:30';
      const result = await journeyTimeHandler(mockContext);

      expect(result.response).toContain('couldn\'t find any trains');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should handle API timeout gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce({
        code: 'ECONNABORTED',
        message: 'timeout of 30000ms exceeded',
      });

      mockContext.messageBody = '14:30';
      const result = await journeyTimeHandler(mockContext);

      expect(result.response).toContain('taking longer than expected');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should handle 404 response', async () => {
      mockedAxios.get.mockRejectedValueOnce({
        response: { status: 404 },
        message: 'Not found',
      });

      mockContext.messageBody = '14:30';
      const result = await journeyTimeHandler(mockContext);

      expect(result.response).toContain('couldn\'t find any trains');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });
  });

  describe('Missing stateData', () => {
    it('should return error when origin missing', async () => {
      mockContext.stateData = { travelDate: '2026-01-24', journeyId: 'test' };
      mockContext.messageBody = '14:30';

      const result = await journeyTimeHandler(mockContext);

      expect(result.response).toContain('start again');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_DATE);
    });

    it('should return error when JOURNEY_MATCHER_URL not configured', async () => {
      delete process.env.JOURNEY_MATCHER_URL;
      mockContext.messageBody = '14:30';

      const result = await journeyTimeHandler(mockContext);

      expect(result.response).toContain('Something went wrong');
      expect(result.nextState).toBe(FSMState.ERROR);
    });
  });

  describe('Invalid times', () => {
    it('should reject invalid time format', async () => {
      mockContext.messageBody = 'invalid';
      const result = await journeyTimeHandler(mockContext);
      expect(result.response).toContain('Invalid');
      expect(result.nextState).toBe(FSMState.AWAITING_JOURNEY_TIME);
    });

    it('should provide helpful hint', async () => {
      mockContext.messageBody = 'xyz';
      const result = await journeyTimeHandler(mockContext);
      expect(result.response).toContain('14:30');
      expect(result.response).toContain('2:30pm');
    });
  });
});
