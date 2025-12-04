/**
 * Unit tests for OutboxRepository v2.0
 * Per ADR-014 (TDD): Tests written BEFORE implementation
 * Per ADR-004: Using Vitest test framework
 *
 * SPEC: Notion › Architecture › Data Layer › whatsapp_handler.outbox_events
 * RFC: RFC-whatsapp-handler-schema-v2.md § 2.3 Outbox Events (Simplified)
 *
 * DESIGN: Transactional outbox pattern for eventual consistency
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { OutboxRepository } from '../../../../src/db/repositories/outbox.repository';
import type { OutboxEvent, CreateOutboxEventDTO } from '../../../../src/db/types.v2';

describe('OutboxRepository v2.0', () => {
  let mockPool: Pool;
  let repository: OutboxRepository;

  const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440001';
  const TEST_EVENT_ID = '550e8400-e29b-41d4-a716-446655440099';

  beforeEach(() => {
    // Mock Pool
    mockPool = {
      query: vi.fn(),
    } as unknown as Pool;

    repository = new OutboxRepository(mockPool);
  });

  describe('insertEvent', () => {
    it('should insert a new outbox event', async () => {
      // Arrange
      const createDTO: CreateOutboxEventDTO = {
        aggregate_id: TEST_USER_ID,
        aggregate_type: 'user',
        event_type: 'user.registered',
        payload: { phone_number: '+447700900123' },
      };

      const mockCreatedEvent: OutboxEvent = {
        id: TEST_EVENT_ID,
        aggregate_id: TEST_USER_ID,
        aggregate_type: 'user',
        event_type: 'user.registered',
        payload: { phone_number: '+447700900123' },
        published_at: null, // Not yet published
        created_at: new Date('2025-01-01T10:00:00Z'),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockCreatedEvent],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.insertEvent(
        TEST_USER_ID,
        'user',
        'user.registered',
        { phone_number: '+447700900123' }
      );

      // Assert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO whatsapp_handler.outbox_events'),
        [TEST_USER_ID, 'user', 'user.registered', { phone_number: '+447700900123' }]
      );
      expect(result).toEqual(mockCreatedEvent);
      expect(result.published_at).toBeNull();
    });

    it('should insert journey event with correct aggregate type', async () => {
      // Arrange
      const mockJourneyEvent: OutboxEvent = {
        id: TEST_EVENT_ID,
        aggregate_id: 'journey-123',
        aggregate_type: 'journey',
        event_type: 'journey.created',
        payload: { from: 'London', to: 'Manchester', date: '2025-01-15' },
        published_at: null,
        created_at: new Date('2025-01-01T10:00:00Z'),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockJourneyEvent],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.insertEvent(
        'journey-123',
        'journey',
        'journey.created',
        { from: 'London', to: 'Manchester', date: '2025-01-15' }
      );

      // Assert
      expect(result.aggregate_type).toBe('journey');
      expect(result.event_type).toBe('journey.created');
    });

    it('should throw error when invalid aggregate type provided', async () => {
      // Arrange - PostgreSQL CHECK constraint violation
      const dbError = new Error('CHECK constraint violation') as any;
      dbError.code = '23514'; // PostgreSQL CHECK violation code

      vi.mocked(mockPool.query).mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(
        repository.insertEvent(TEST_USER_ID, 'invalid_type' as any, 'event.test', {})
      ).rejects.toThrow('CHECK constraint violation');
    });
  });

  describe('getUnpublishedEvents', () => {
    it('should return unpublished events with default limit', async () => {
      // Arrange
      const mockUnpublishedEvents: OutboxEvent[] = [
        {
          id: TEST_EVENT_ID,
          aggregate_id: TEST_USER_ID,
          aggregate_type: 'user',
          event_type: 'user.registered',
          payload: { phone_number: '+447700900123' },
          published_at: null,
          created_at: new Date('2025-01-01T10:00:00Z'),
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440098',
          aggregate_id: TEST_USER_ID,
          aggregate_type: 'user',
          event_type: 'user.verified',
          payload: { verified_at: '2025-01-01T10:05:00Z' },
          published_at: null,
          created_at: new Date('2025-01-01T10:05:00Z'),
        },
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockUnpublishedEvents,
        command: 'SELECT',
        rowCount: 2,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.getUnpublishedEvents();

      // Assert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE published_at IS NULL'),
        [100] // Default limit
      );
      expect(result).toEqual(mockUnpublishedEvents);
      expect(result).toHaveLength(2);
    });

    it('should return unpublished events with custom limit', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      // Act
      await repository.getUnpublishedEvents(10);

      // Assert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1'),
        [10]
      );
    });

    it('should return empty array when no unpublished events exist', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.getUnpublishedEvents();

      // Assert
      expect(result).toEqual([]);
    });

    it('should order events by created_at ASC (oldest first)', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      // Act
      await repository.getUnpublishedEvents();

      // Assert
      const callArgs = vi.mocked(mockPool.query).mock.calls[0];
      expect(callArgs[0]).toContain('ORDER BY created_at ASC');
    });
  });

  describe('markAsPublished', () => {
    it('should mark an event as published with current timestamp', async () => {
      // Arrange
      const publishedEvent: OutboxEvent = {
        id: TEST_EVENT_ID,
        aggregate_id: TEST_USER_ID,
        aggregate_type: 'user',
        event_type: 'user.registered',
        payload: { phone_number: '+447700900123' },
        published_at: new Date('2025-01-01T10:10:00Z'), // Now published
        created_at: new Date('2025-01-01T10:00:00Z'),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [publishedEvent],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.markAsPublished(TEST_EVENT_ID);

      // Assert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE whatsapp_handler.outbox_events'),
        [TEST_EVENT_ID]
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SET published_at = NOW()'),
        [TEST_EVENT_ID]
      );
      expect(result).toEqual(publishedEvent);
      expect(result.published_at).not.toBeNull();
    });

    it('should return null when event ID does not exist', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'UPDATE',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.markAsPublished('non-existent-id');

      // Assert
      expect(result).toBeNull();
    });

    it('should handle already published events idempotently', async () => {
      // Arrange - Event already has published_at set
      const alreadyPublishedEvent: OutboxEvent = {
        id: TEST_EVENT_ID,
        aggregate_id: TEST_USER_ID,
        aggregate_type: 'user',
        event_type: 'user.registered',
        payload: { phone_number: '+447700900123' },
        published_at: new Date('2025-01-01T10:10:00Z'), // Already published
        created_at: new Date('2025-01-01T10:00:00Z'),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [alreadyPublishedEvent],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.markAsPublished(TEST_EVENT_ID);

      // Assert - Should still return the event (idempotent operation)
      expect(result).toEqual(alreadyPublishedEvent);
    });
  });

  describe('getEventById', () => {
    it('should return an event by ID', async () => {
      // Arrange
      const mockEvent: OutboxEvent = {
        id: TEST_EVENT_ID,
        aggregate_id: TEST_USER_ID,
        aggregate_type: 'user',
        event_type: 'user.registered',
        payload: { phone_number: '+447700900123' },
        published_at: null,
        created_at: new Date('2025-01-01T10:00:00Z'),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockEvent],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.getEventById(TEST_EVENT_ID);

      // Assert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        [TEST_EVENT_ID]
      );
      expect(result).toEqual(mockEvent);
    });

    it('should return null when event ID does not exist', async () => {
      // Arrange
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await repository.getEventById('non-existent-id');

      // Assert
      expect(result).toBeNull();
    });
  });
});
