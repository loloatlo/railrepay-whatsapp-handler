/**
 * TD-WHATSAPP-055: journey.created Payload Missing Journey Data
 *
 * TD CONTEXT: ticket-upload.handler constructs journey.created event payload
 * with ONLY user_id, phone_number, ticket_url, created_at, correlation_id, causation_id.
 * The payload omits ALL journey data from ctx.stateData (journeyId, origin, destination,
 * travelDate, matchedRoute), causing journey-matcher to reject EVERY event.
 *
 * REQUIRED FIX: Enrich payload with journey fields from stateData
 * IMPACT: BLOCKING - downstream journey-matcher cannot process any journey.created events
 *
 * Phase TD-1: Test Specification (Jessie)
 * These tests MUST FAIL initially - proving the technical debt exists.
 * Blake will implement to make these tests GREEN in Phase TD-2.
 *
 * TDD Rules (ADR-014):
 * - Tests written BEFORE implementation
 * - Blake MUST NOT modify these tests (Test Lock Rule)
 *
 * Acceptance Criteria to Test:
 * AC-1: payload includes journey_id (from stateData.journeyId)
 * AC-2: payload includes origin_crs and destination_crs (from stateData.origin/destination)
 * AC-3: payload includes departure_datetime (from stateData.travelDate + matchedRoute.legs[0].departure)
 * AC-4: payload includes arrival_datetime (from matchedRoute.legs[lastIndex].arrival)
 * AC-5: payload includes journey_type (default 'single' for MVP)
 * AC-6: payload includes legs array with full segment data (from, to, departure, arrival, operator per leg)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ticketUploadHandler } from '../../../src/handlers/ticket-upload.handler';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

describe('TD-WHATSAPP-055: ticket-upload.handler journey.created payload enrichment', () => {
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

    // Context with FULL stateData from journey flow
    mockContext = {
      phoneNumber: '+447700900123',
      messageBody: 'SKIP',
      messageSid: 'SM123',
      user: mockUser,
      currentState: FSMState.AWAITING_TICKET_UPLOAD,
      correlationId: 'test-corr-id',
      stateData: {
        travelDate: '2026-02-08',
        journeyId: '0c751b0a-e29b-41d4-a716-446655440000',
        origin: 'PAD',
        destination: 'CDF',
        originName: 'London Paddington',
        destinationName: 'Cardiff Central',
        departureTime: '14:30',
        matchedRoute: {
          legs: [
            {
              from: 'London Paddington',
              to: 'Cardiff Central',
              departure: '14:45',
              arrival: '16:34',
              operator: '1:GW',
            },
          ],
          totalDuration: '1h 49m',
          isDirect: true,
        },
        confirmedRoute: {
          legs: [
            {
              from: 'London Paddington',
              to: 'Cardiff Central',
              departure: '14:45',
              arrival: '16:34',
              operator: '1:GW',
            },
          ],
          totalDuration: '1h 49m',
          isDirect: true,
        },
        journeyConfirmed: true,
      },
    };
  });

  describe('AC-1: payload includes journey_id from stateData.journeyId', () => {
    it('should include journey_id in journey.created event payload', async () => {
      const result = await ticketUploadHandler(mockContext);

      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents?.length).toBeGreaterThan(0);

      const event = result.publishEvents![0];
      expect(event.event_type).toBe('journey.created');
      expect(event.payload).toHaveProperty('journey_id');
      expect(event.payload.journey_id).toBe('0c751b0a-e29b-41d4-a716-446655440000');
    });

    it('should use stateData.journeyId as journey_id (not a randomly generated UUID)', async () => {
      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      // This test will FAIL because current implementation uses randomUUID() for aggregate_id
      // and doesn't read from stateData.journeyId
      expect(event.payload.journey_id).toBe(mockContext.stateData?.journeyId);
    });
  });

  describe('AC-2: payload includes origin_crs and destination_crs from stateData', () => {
    it('should include origin_crs from stateData.origin', async () => {
      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload).toHaveProperty('origin_crs');
      expect(event.payload.origin_crs).toBe('PAD');
    });

    it('should include destination_crs from stateData.destination', async () => {
      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload).toHaveProperty('destination_crs');
      expect(event.payload.destination_crs).toBe('CDF');
    });

    it('should use 3-letter CRS codes in uppercase', async () => {
      // Test with different stations
      mockContext.stateData!.origin = 'KGX';
      mockContext.stateData!.destination = 'YRK';

      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.origin_crs).toBe('KGX');
      expect(event.payload.destination_crs).toBe('YRK');
    });
  });

  describe('AC-3: payload includes departure_datetime from stateData', () => {
    it('should include departure_datetime combining travelDate and first leg departure', async () => {
      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload).toHaveProperty('departure_datetime');
      // Expected format: ISO 8601 datetime combining travelDate (2026-02-08) + departure (14:45)
      expect(event.payload.departure_datetime).toMatch(/2026-02-08T14:45:00/);
    });

    it('should format departure_datetime as valid ISO 8601', async () => {
      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      // ISO 8601: YYYY-MM-DDTHH:mm:ssZ
      expect(event.payload.departure_datetime).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(.\d{3})?Z?$/
      );
    });

    it('should derive departure_datetime from matchedRoute.legs[0].departure', async () => {
      // Change first leg departure time
      mockContext.stateData!.matchedRoute!.legs[0].departure = '09:15';

      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.departure_datetime).toMatch(/09:15:00/);
    });
  });

  describe('AC-4: payload includes arrival_datetime from last leg', () => {
    it('should include arrival_datetime from last leg in single-leg journey', async () => {
      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload).toHaveProperty('arrival_datetime');
      // Last leg (only leg) arrival: 16:34
      expect(event.payload.arrival_datetime).toMatch(/2026-02-08T16:34:00/);
    });

    it('should use last leg arrival in multi-leg journey', async () => {
      // Multi-leg journey: PAD -> RDG -> CDF
      mockContext.stateData!.matchedRoute = {
        legs: [
          {
            from: 'London Paddington',
            to: 'Reading',
            departure: '14:45',
            arrival: '15:10',
            operator: '1:GW',
          },
          {
            from: 'Reading',
            to: 'Cardiff Central',
            departure: '15:30',
            arrival: '17:00',
            operator: '1:GW',
          },
        ],
        totalDuration: '2h 15m',
        isDirect: false,
      };

      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      // Should use last leg (Reading -> Cardiff) arrival: 17:00
      expect(event.payload.arrival_datetime).toMatch(/17:00:00/);
    });
  });

  describe('AC-5: payload includes journey_type (default single)', () => {
    it('should include journey_type field', async () => {
      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload).toHaveProperty('journey_type');
    });

    it('should default to "single" for MVP', async () => {
      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.journey_type).toBe('single');
    });
  });

  describe('AC-6: payload includes legs array with segment data', () => {
    it('should include legs array in payload', async () => {
      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload).toHaveProperty('legs');
      expect(Array.isArray(event.payload.legs)).toBe(true);
    });

    it('should include all legs from matchedRoute in single-leg journey', async () => {
      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.legs).toHaveLength(1);

      const leg = event.payload.legs[0];
      expect(leg).toMatchObject({
        from: 'London Paddington',
        to: 'Cardiff Central',
        departure: '14:45',
        arrival: '16:34',
        operator: '1:GW',
      });
    });

    it('should include all legs from matchedRoute in multi-leg journey', async () => {
      // Multi-leg journey
      mockContext.stateData!.matchedRoute = {
        legs: [
          {
            from: 'London Paddington',
            to: 'Reading',
            departure: '14:45',
            arrival: '15:10',
            operator: '1:GW',
          },
          {
            from: 'Reading',
            to: 'Cardiff Central',
            departure: '15:30',
            arrival: '17:00',
            operator: '1:GW',
          },
        ],
        totalDuration: '2h 15m',
        isDirect: false,
      };

      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.legs).toHaveLength(2);

      expect(event.payload.legs[0]).toMatchObject({
        from: 'London Paddington',
        to: 'Reading',
        departure: '14:45',
        arrival: '15:10',
        operator: '1:GW',
      });

      expect(event.payload.legs[1]).toMatchObject({
        from: 'Reading',
        to: 'Cardiff Central',
        departure: '15:30',
        arrival: '17:00',
        operator: '1:GW',
      });
    });

    it('should preserve operator field from each leg', async () => {
      // Different operators per leg
      mockContext.stateData!.matchedRoute = {
        legs: [
          {
            from: 'London Paddington',
            to: 'Reading',
            departure: '14:45',
            arrival: '15:10',
            operator: '1:GW',
          },
          {
            from: 'Reading',
            to: 'Cardiff Central',
            departure: '15:30',
            arrival: '17:00',
            operator: '2:AW',
          },
        ],
        totalDuration: '2h 15m',
        isDirect: false,
      };

      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      expect(event.payload.legs[0].operator).toBe('1:GW');
      expect(event.payload.legs[1].operator).toBe('2:AW');
    });
  });

  describe('Backward compatibility - no stateData', () => {
    it('should still work when stateData is missing (legacy behavior)', async () => {
      // Context without stateData (e.g., old FSM state)
      mockContext.stateData = undefined;

      const result = await ticketUploadHandler(mockContext);

      expect(result.publishEvents).toBeDefined();
      const event = result.publishEvents![0];
      expect(event.event_type).toBe('journey.created');
      // Should still have basic fields (user_id, phone_number, etc.)
      expect(event.payload).toHaveProperty('user_id');
      expect(event.payload).toHaveProperty('phone_number');
    });

    it('should still work when matchedRoute is missing', async () => {
      mockContext.stateData = {
        journeyId: 'test-journey-id',
        origin: 'PAD',
        destination: 'CDF',
        travelDate: '2026-02-08',
        // matchedRoute missing
      };

      const result = await ticketUploadHandler(mockContext);

      expect(result.publishEvents).toBeDefined();
      const event = result.publishEvents![0];
      // Should still publish event even without matchedRoute
      expect(event.event_type).toBe('journey.created');
    });
  });

  describe('Media upload with enriched payload', () => {
    it('should include journey data when media is uploaded', async () => {
      mockContext.mediaUrl = 'https://api.twilio.com/media/456';

      const result = await ticketUploadHandler(mockContext);

      const event = result.publishEvents![0];
      // Should have BOTH ticket_url AND journey data
      expect(event.payload.ticket_url).toBe('https://api.twilio.com/media/456');
      expect(event.payload.journey_id).toBe('0c751b0a-e29b-41d4-a716-446655440000');
      expect(event.payload.origin_crs).toBe('PAD');
      expect(event.payload.destination_crs).toBe('CDF');
    });
  });
});
