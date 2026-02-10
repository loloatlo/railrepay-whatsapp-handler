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

  describe('TD-WHATSAPP-059: tripId field in journey.created event', () => {
    // AC-1: journey.created outbox event legs include tripId field from stateData's confirmedRoute
    it('should include tripId in each leg when present in stateData', async () => {
      mockContext.mediaUrl = 'https://api.twilio.com/media/123';
      mockContext.stateData = {
        journeyId: 'journey-123',
        origin: 'PAD',
        destination: 'OXF',
        travelDate: '2024-11-20',
        confirmedRoute: {
          legs: [
            {
              from: 'PAD',
              to: 'RDG',
              departure: '10:00',
              arrival: '10:30',
              operator: 'GWR',
              tripId: '202411201000001', // Darwin RID present
            },
            {
              from: 'RDG',
              to: 'OXF',
              departure: '10:45',
              arrival: '11:15',
              operator: 'GWR',
              tripId: '202411201045002', // Darwin RID present
            },
          ],
        },
      };

      const result = await ticketUploadHandler(mockContext);
      expect(result.publishEvents).toBeDefined();
      expect(result.publishEvents?.length).toBe(1);

      const event = result.publishEvents![0];
      expect(event.event_type).toBe('journey.created');
      expect(event.payload.legs).toBeDefined();
      expect(event.payload.legs.length).toBe(2);

      // Verify first leg has tripId
      expect(event.payload.legs[0]).toHaveProperty('tripId');
      expect(event.payload.legs[0].tripId).toBe('202411201000001');

      // Verify second leg has tripId
      expect(event.payload.legs[1]).toHaveProperty('tripId');
      expect(event.payload.legs[1].tripId).toBe('202411201045002');
    });

    // AC-2: When tripId is absent in stateData (legacy routes), field defaults to null
    it('should default tripId to null when absent from stateData legs', async () => {
      mockContext.mediaUrl = 'https://api.twilio.com/media/123';
      mockContext.stateData = {
        journeyId: 'journey-legacy',
        origin: 'PAD',
        destination: 'OXF',
        travelDate: '2024-11-20',
        confirmedRoute: {
          legs: [
            {
              from: 'PAD',
              to: 'OXF',
              departure: '10:00',
              arrival: '11:00',
              operator: 'GWR',
              // tripId NOT present (legacy route from journey-matcher)
            },
          ],
        },
      };

      const result = await ticketUploadHandler(mockContext);
      expect(result.publishEvents).toBeDefined();
      const event = result.publishEvents![0];
      expect(event.event_type).toBe('journey.created');
      expect(event.payload.legs).toBeDefined();
      expect(event.payload.legs.length).toBe(1);

      // Verify tripId exists but is null
      expect(event.payload.legs[0]).toHaveProperty('tripId');
      expect(event.payload.legs[0].tripId).toBeNull();
    });

    // AC-4: Dedicated unit test asserting tripId presence in outbox event leg payload
    it('should include tripId field in mixed scenario (some legs with tripId, some without)', async () => {
      mockContext.mediaUrl = 'https://api.twilio.com/media/123';
      mockContext.stateData = {
        journeyId: 'journey-mixed',
        origin: 'PAD',
        destination: 'BHM',
        travelDate: '2024-11-20',
        confirmedRoute: {
          legs: [
            {
              from: 'PAD',
              to: 'RDG',
              departure: '10:00',
              arrival: '10:30',
              operator: 'GWR',
              tripId: '202411201000001', // Has tripId
            },
            {
              from: 'RDG',
              to: 'OXF',
              departure: '10:45',
              arrival: '11:15',
              operator: 'GWR',
              // No tripId (bus replacement service, for example)
            },
            {
              from: 'OXF',
              to: 'BHM',
              departure: '11:30',
              arrival: '12:30',
              operator: 'CHR',
              tripId: '202411201130003', // Has tripId
            },
          ],
        },
      };

      const result = await ticketUploadHandler(mockContext);
      expect(result.publishEvents).toBeDefined();
      const event = result.publishEvents![0];
      expect(event.event_type).toBe('journey.created');
      expect(event.payload.legs).toBeDefined();
      expect(event.payload.legs.length).toBe(3);

      // Leg 1: Has tripId
      expect(event.payload.legs[0]).toHaveProperty('tripId');
      expect(event.payload.legs[0].tripId).toBe('202411201000001');

      // Leg 2: No tripId, should be null
      expect(event.payload.legs[1]).toHaveProperty('tripId');
      expect(event.payload.legs[1].tripId).toBeNull();

      // Leg 3: Has tripId
      expect(event.payload.legs[2]).toHaveProperty('tripId');
      expect(event.payload.legs[2].tripId).toBe('202411201130003');
    });

    // AC-4: Verify tripId field exists alongside other leg fields
    it('should include tripId alongside all existing leg fields', async () => {
      mockContext.mediaUrl = 'https://api.twilio.com/media/123';
      mockContext.stateData = {
        journeyId: 'journey-complete',
        origin: 'PAD',
        destination: 'OXF',
        travelDate: '2024-11-20',
        confirmedRoute: {
          legs: [
            {
              from: 'PAD',
              to: 'OXF',
              departure: '10:00',
              arrival: '11:00',
              operator: 'GWR',
              tripId: '202411201000001',
            },
          ],
        },
      };

      const result = await ticketUploadHandler(mockContext);
      const event = result.publishEvents![0];
      const leg = event.payload.legs[0];

      // Verify all 6 fields are present (5 existing + tripId)
      expect(leg).toHaveProperty('from', 'PAD');
      expect(leg).toHaveProperty('to', 'OXF');
      expect(leg).toHaveProperty('departure', '10:00');
      expect(leg).toHaveProperty('arrival', '11:00');
      expect(leg).toHaveProperty('operator', 'GWR');
      expect(leg).toHaveProperty('tripId', '202411201000001');
    });

    // AC-1: Verify tripId is read from matchedRoute when confirmedRoute not present
    it('should read tripId from matchedRoute when confirmedRoute is absent', async () => {
      mockContext.mediaUrl = 'https://api.twilio.com/media/123';
      mockContext.stateData = {
        journeyId: 'journey-matched',
        origin: 'PAD',
        destination: 'OXF',
        travelDate: '2024-11-20',
        matchedRoute: {
          // Using matchedRoute instead of confirmedRoute
          legs: [
            {
              from: 'PAD',
              to: 'OXF',
              departure: '10:00',
              arrival: '11:00',
              operator: 'GWR',
              tripId: '202411201000001',
            },
          ],
        },
      };

      const result = await ticketUploadHandler(mockContext);
      const event = result.publishEvents![0];
      expect(event.payload.legs[0]).toHaveProperty('tripId', '202411201000001');
    });
  });
});
