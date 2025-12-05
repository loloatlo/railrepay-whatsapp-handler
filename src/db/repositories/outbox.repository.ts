/**
 * OutboxRepository v2.0 - Transactional Outbox Pattern
 *
 * SPEC: Notion › Architecture › Data Layer › whatsapp_handler.outbox_events
 * RFC: RFC-whatsapp-handler-schema-v2.md § 2.3 Outbox Events (Simplified)
 * Per ADR-014: Implementation written AFTER tests
 * Per ADR-001: Schema-per-service isolation (whatsapp_handler schema)
 *
 * DESIGN:
 * - Implements transactional outbox pattern for eventual consistency
 * - Events inserted in same transaction as business logic
 * - Separate publisher process reads unpublished events and publishes to Kafka
 * - Simplified schema (no event_version, metadata, correlation_id - YAGNI)
 *
 * REFERENCES:
 * - Notion › Architecture › ADRs › ADR-003: Transactional Outbox Pattern
 */

import type { Pool } from 'pg';
import type { OutboxEvent } from '../types.v2.js';

export class OutboxRepository {
  constructor(private pool: Pool) {}

  /**
   * Insert a new outbox event
   *
   * USAGE: Call this in the same transaction as your business logic update
   * to guarantee atomic writes.
   *
   * @param aggregateId - ID of the aggregate (e.g., user_id, journey_id)
   * @param aggregateType - Type of aggregate ('user', 'journey', 'claim')
   * @param eventType - Event type (e.g., 'user.registered', 'user.verified')
   * @param payload - JSONB event payload
   * @returns Created outbox event
   * @throws Error if CHECK constraint fails (invalid aggregate_type)
   */
  async insertEvent(
    aggregateId: string,
    aggregateType: 'user' | 'journey' | 'claim',
    eventType: string,
    payload: Record<string, any>
  ): Promise<OutboxEvent> {
    const result = await this.pool.query<OutboxEvent>(
      `INSERT INTO whatsapp_handler.outbox_events (aggregate_id, aggregate_type, event_type, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING id, aggregate_id, aggregate_type, event_type, payload, published_at, created_at`,
      [aggregateId, aggregateType, eventType, payload]
    );

    return result.rows[0];
  }

  /**
   * Get unpublished events (published_at IS NULL)
   *
   * USAGE: Called by background publisher process to find events to publish
   * Events are ordered by created_at ASC (oldest first) to maintain ordering
   *
   * @param limit - Maximum number of events to fetch (default: 100)
   * @returns Array of unpublished events
   */
  async getUnpublishedEvents(limit: number = 100): Promise<OutboxEvent[]> {
    const result = await this.pool.query<OutboxEvent>(
      `SELECT id, aggregate_id, aggregate_type, event_type, payload, published_at, created_at
       FROM whatsapp_handler.outbox_events
       WHERE published_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  }

  /**
   * Mark an event as published
   *
   * USAGE: Called by background publisher after successfully publishing to Kafka
   * Sets published_at = NOW()
   *
   * IDEMPOTENCY: Safe to call multiple times (idempotent operation)
   *
   * @param eventId - UUID of the event to mark as published
   * @returns Updated event or null if not found
   */
  async markAsPublished(eventId: string): Promise<OutboxEvent | null> {
    const result = await this.pool.query<OutboxEvent>(
      `UPDATE whatsapp_handler.outbox_events
       SET published_at = NOW()
       WHERE id = $1
       RETURNING id, aggregate_id, aggregate_type, event_type, payload, published_at, created_at`,
      [eventId]
    );

    return result.rows[0] ?? null;
  }

  /**
   * Get an event by ID
   *
   * USAGE: For debugging or verification purposes
   *
   * @param eventId - UUID of the event
   * @returns Event or null if not found
   */
  async getEventById(eventId: string): Promise<OutboxEvent | null> {
    const result = await this.pool.query<OutboxEvent>(
      `SELECT id, aggregate_id, aggregate_type, event_type, payload, published_at, created_at
       FROM whatsapp_handler.outbox_events
       WHERE id = $1`,
      [eventId]
    );

    return result.rows[0] ?? null;
  }
}
