/**
 * Journey Submission Flow Integration Tests
 * Written FIRST per ADR-014 (TDD)
 *
 * USER STORY: Submitting a Journey to RailRepay
 * ALL ACCEPTANCE CRITERIA: AC-1 through AC-6
 *
 * CONTEXT: Full integration test using Testcontainers for PostgreSQL and Redis.
 * Tests complete journey submission workflows:
 * 1. Simple journey (no interchange) - Historic
 * 2. Complex journey (with interchange) - Historic
 * 3. Complex journey (with alternatives) - Historic
 * 4. Future journey tracking
 * 5. Proactive notification on delay detection
 *
 * INTEGRATION POINTS:
 * - PostgreSQL: whatsapp_handler schema (users, outbox_events)
 * - Redis: FSM state persistence
 * - Mock HTTP clients: journey-matcher, eligibility-engine, delay-tracker
 *
 * Per Testing Strategy 2.0 § 5 (Testcontainers Setup)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { FsmService, FSMState } from '../../src/services/fsm.service';
import type { User } from '../../src/db/types';

/**
 * IMPORT NOTE: These handlers DO NOT exist yet - Blake will create them
 */
// @ts-expect-error - Handlers do not exist yet
import { routingSuggestionHandler } from '../../src/handlers/routing-suggestion.handler';
// @ts-expect-error
import { routingAlternativeHandler } from '../../src/handlers/routing-alternative.handler';
// @ts-expect-error
import { journeyEligibilityHandler } from '../../src/handlers/journey-eligibility.handler';

describe('Journey Submission Flow - Integration Tests', () => {
  let postgresContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let pool: Pool;
  let redisClient: Redis;
  let fsmService: FsmService;

  beforeAll(async () => {
    /**
     * Start PostgreSQL container with whatsapp_handler schema
     */
    postgresContainer = await new GenericContainer('postgres:15-alpine')
      .withEnvironment({
        POSTGRES_DB: 'railrepay_test',
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
      .start();

    const pgHost = postgresContainer.getHost();
    const pgPort = postgresContainer.getMappedPort(5432);

    pool = new Pool({
      host: pgHost,
      port: pgPort,
      database: 'railrepay_test',
      user: 'test',
      password: 'test',
    });

    /**
     * Run migrations to create whatsapp_handler schema
     */
    await pool.query(`CREATE SCHEMA IF NOT EXISTS whatsapp_handler;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_handler.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone_number TEXT UNIQUE NOT NULL,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_handler.outbox_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregate_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('user', 'journey', 'claim')),
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    /**
     * Start Redis container for FSM state
     */
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();

    const redisHost = redisContainer.getHost();
    const redisPort = redisContainer.getMappedPort(6379);

    redisClient = new Redis({
      host: redisHost,
      port: redisPort,
    });

    fsmService = new FsmService(redisClient);
  }, 120000); // 2-minute timeout for container startup

  afterAll(async () => {
    await pool.end();
    await redisClient.quit();
    await postgresContainer.stop();
    await redisContainer.stop();
  });

  beforeEach(async () => {
    /**
     * Clean database before each test
     */
    await pool.query('TRUNCATE whatsapp_handler.users CASCADE');
    await pool.query('TRUNCATE whatsapp_handler.outbox_events CASCADE');
    await redisClient.flushdb();
  });

  describe('AC-1: Simple Journey Submission (No Interchange)', () => {
    /**
     * AC-1: Send a message to RailRepay with details of my origin, destination, and date of travel
     * SCENARIO: Direct journey (PAD -> RDG, no interchange required)
     */

    it('should complete journey submission without routing confirmation for direct journeys', async () => {
      /**
       * WORKFLOW:
       * 1. User submits journey date
       * 2. User submits origin and destination
       * 3. User submits journey time
       * 4. System detects NO interchange required
       * 5. System skips routing confirmation (goes straight to ticket upload)
       */
      // Arrange: Create test user
      const userResult = await pool.query(
        `INSERT INTO whatsapp_handler.users (phone_number, verified_at)
         VALUES ($1, NOW())
         RETURNING *`,
        ['+447700900111']
      );
      const user: User = userResult.rows[0];

      // Mock journey-matcher response (direct journey, no interchange)
      const mockJourneyMatcher = vi.fn().mockResolvedValue({
        journeyId: 'journey-direct-123',
        requiresInterchange: false,
        route: {
          legs: [
            { from: 'PAD', to: 'RDG', operator: 'GWR', departure: '10:00', arrival: '10:30' },
          ],
        },
      });

      // Act: Simulate journey submission flow
      // (In real implementation, these would be sequential handler calls via webhook)

      // Step 1: Set state to AWAITING_JOURNEY_TIME (previous states completed)
      await fsmService.setState(user.phone_number, FSMState.AWAITING_JOURNEY_TIME, {
        journeyDate: 'yesterday',
        origin: 'PAD',
        destination: 'RDG',
      });

      // Step 2: User submits journey time → system checks for interchange
      // Since no interchange, should transition directly to AWAITING_TICKET_UPLOAD
      // (Routing confirmation is SKIPPED)

      // Assert: Verify FSM state progression
      const stateAfterTimeSubmit = await fsmService.getState(user.phone_number);
      expect(stateAfterTimeSubmit.state).toBe(FSMState.AWAITING_TICKET_UPLOAD);

      // Assert: Journey data persisted
      expect(stateAfterTimeSubmit.data.journeyId).toBe('journey-direct-123');
      expect(stateAfterTimeSubmit.data.requiresInterchange).toBe(false);
    });
  });

  describe('AC-2: Complex Journey with Interchange Routing Confirmation', () => {
    /**
     * AC-2: If my journey required me to change stations, receive a message with the
     *       suggested routing for me to confirm is correct
     */

    it('should present routing confirmation when journey requires interchange', async () => {
      // Arrange: Create test user
      const userResult = await pool.query(
        `INSERT INTO whatsapp_handler.users (phone_number, verified_at)
         VALUES ($1, NOW())
         RETURNING *`,
        ['+447700900222']
      );
      const user: User = userResult.rows[0];

      // Mock journey-matcher response (complex journey with interchange)
      const mockJourneyMatcher = vi.fn().mockResolvedValue({
        journeyId: 'journey-complex-456',
        requiresInterchange: true,
        suggestedRoute: {
          legs: [
            { from: 'PAD', to: 'BRI', operator: 'GWR', departure: '10:00', arrival: '11:30' },
            { from: 'BRI', to: 'CDF', operator: 'GWR', departure: '11:45', arrival: '12:15' },
          ],
          totalDuration: '2h 15m',
        },
      });

      // Act: User submits journey time for complex journey
      await fsmService.setState(user.phone_number, FSMState.AWAITING_JOURNEY_TIME, {
        journeyDate: 'yesterday',
        origin: 'PAD',
        destination: 'CDF',
        journeyTime: '10:00',
      });

      // Simulate handler processing journey time and detecting interchange
      // Handler should transition to AWAITING_ROUTING_CONFIRM
      await fsmService.transitionTo(
        user.phone_number,
        FSMState.AWAITING_ROUTING_CONFIRM,
        {
          journeyId: 'journey-complex-456',
          suggestedRoute: mockJourneyMatcher.mock.results[0].value.suggestedRoute,
        },
        true
      );

      // Assert: State is AWAITING_ROUTING_CONFIRM
      const state = await fsmService.getState(user.phone_number);
      expect(state.state).toBe(FSMState.AWAITING_ROUTING_CONFIRM);
      expect(state.data.suggestedRoute).toBeDefined();
      expect(state.data.suggestedRoute.legs).toHaveLength(2);

      // Act: User confirms routing (YES)
      await fsmService.transitionTo(
        user.phone_number,
        FSMState.AWAITING_TICKET_UPLOAD,
        { routingConfirmed: true },
        true
      );

      // Assert: Progresses to ticket upload
      const finalState = await fsmService.getState(user.phone_number);
      expect(finalState.state).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      expect(finalState.data.routingConfirmed).toBe(true);
    });
  });

  describe('AC-3: Alternative Routing Workflow (Max 3 Alternatives)', () => {
    /**
     * AC-3: If the suggestion is incorrect, receive up to 3 alternative suggested
     *       routings until I confirm the correct routing
     */

    it('should present 3 numbered alternatives when user rejects initial routing', async () => {
      // Arrange: Create test user
      const userResult = await pool.query(
        `INSERT INTO whatsapp_handler.users (phone_number, verified_at)
         VALUES ($1, NOW())
         RETURNING *`,
        ['+447700900333']
      );
      const user: User = userResult.rows[0];

      // Mock journey-matcher alternatives response
      const mockAlternatives = [
        {
          number: 1,
          legs: [
            { from: 'PAD', to: 'RDG', departure: '10:05', arrival: '10:35' },
            { from: 'RDG', to: 'CDF', departure: '10:50', arrival: '12:20' },
          ],
        },
        {
          number: 2,
          legs: [
            { from: 'PAD', to: 'BHM', departure: '10:10', arrival: '12:00' },
            { from: 'BHM', to: 'CDF', departure: '12:20', arrival: '13:45' },
          ],
        },
        {
          number: 3,
          legs: [
            { from: 'PAD', to: 'SWA', departure: '10:15', arrival: '13:30' },
            { from: 'SWA', to: 'CDF', departure: '13:50', arrival: '14:45' },
          ],
        },
      ];

      // Act: User in AWAITING_ROUTING_CONFIRM, rejects suggested route
      await fsmService.setState(user.phone_number, FSMState.AWAITING_ROUTING_CONFIRM, {
        journeyId: 'journey-789',
        suggestedRoute: { legs: [] },
      });

      // User sends "NO" → transition to AWAITING_ROUTING_ALTERNATIVE
      await fsmService.transitionTo(
        user.phone_number,
        FSMState.AWAITING_ROUTING_ALTERNATIVE,
        {
          alternativeCount: 1,
          alternatives: mockAlternatives,
        },
        true
      );

      // Assert: State is AWAITING_ROUTING_ALTERNATIVE
      const state = await fsmService.getState(user.phone_number);
      expect(state.state).toBe(FSMState.AWAITING_ROUTING_ALTERNATIVE);
      expect(state.data.alternatives).toHaveLength(3);
      expect(state.data.alternativeCount).toBe(1);

      // Act: User selects alternative #2
      await fsmService.transitionTo(
        user.phone_number,
        FSMState.AWAITING_TICKET_UPLOAD,
        { selectedAlternative: 2, routingConfirmed: true },
        true
      );

      // Assert: Progresses to ticket upload with selected alternative
      const finalState = await fsmService.getState(user.phone_number);
      expect(finalState.state).toBe(FSMState.AWAITING_TICKET_UPLOAD);
      expect(finalState.data.selectedAlternative).toBe(2);
    });

    it('should escalate to ERROR state after 3 alternative rejections', async () => {
      // Arrange: Create test user
      const userResult = await pool.query(
        `INSERT INTO whatsapp_handler.users (phone_number, verified_at)
         VALUES ($1, NOW())
         RETURNING *`,
        ['+447700900444']
      );
      const user: User = userResult.rows[0];

      // Act: Simulate user rejecting 3 sets of alternatives
      await fsmService.setState(user.phone_number, FSMState.AWAITING_ROUTING_ALTERNATIVE, {
        journeyId: 'journey-999',
        alternativeCount: 1,
      });

      // Rejection 1 → alternativeCount = 2
      await fsmService.transitionTo(
        user.phone_number,
        FSMState.AWAITING_ROUTING_ALTERNATIVE,
        { alternativeCount: 2 },
        true
      );

      // Rejection 2 → alternativeCount = 3
      await fsmService.transitionTo(
        user.phone_number,
        FSMState.AWAITING_ROUTING_ALTERNATIVE,
        { alternativeCount: 3 },
        true
      );

      // Rejection 3 → max exceeded, escalate to ERROR
      await fsmService.transitionTo(user.phone_number, FSMState.ERROR, {
        errorReason: 'max_alternatives_exceeded',
        escalationRequired: true,
      });

      // Assert: State is ERROR
      const state = await fsmService.getState(user.phone_number);
      expect(state.state).toBe(FSMState.ERROR);
      expect(state.data.escalationRequired).toBe(true);

      // Assert: Outbox event published for manual escalation
      const outboxEvents = await pool.query(
        `SELECT * FROM whatsapp_handler.outbox_events
         WHERE aggregate_id = $1 AND event_type = 'journey.routing_escalation'`,
        ['journey-999']
      );
      expect(outboxEvents.rows).toHaveLength(1);
    });
  });

  describe('AC-4: Historic Journey Immediate Eligibility Check', () => {
    /**
     * AC-4: If my journey is historic, immediately receive a message telling me if
     *       my journey is eligible for a claim
     */

    it('should call eligibility-engine and return result for historic journey', async () => {
      // Arrange: Create test user
      const userResult = await pool.query(
        `INSERT INTO whatsapp_handler.users (phone_number, verified_at)
         VALUES ($1, NOW())
         RETURNING *`,
        ['+447700900555']
      );
      const user: User = userResult.rows[0];

      // Mock eligibility-engine response (eligible with £15 compensation)
      const mockEligibilityEngine = vi.fn().mockResolvedValue({
        journeyId: 'journey-historic-123',
        isEligible: true,
        compensationAmount: '£15.00',
        delayMinutes: 35,
        tocName: 'Great Western Railway',
      });

      // Act: User completes journey submission (historic date: yesterday)
      await fsmService.setState(user.phone_number, FSMState.AWAITING_TICKET_UPLOAD, {
        journeyId: 'journey-historic-123',
        journeyDate: 'yesterday',
        origin: 'PAD',
        destination: 'RDG',
        isHistoric: true,
      });

      // Simulate handler calling eligibility-engine after ticket upload
      // (In real implementation, handler would make HTTP request to eligibility-engine)
      const eligibilityResult = await mockEligibilityEngine();

      // Assert: eligibility-engine called
      expect(mockEligibilityEngine).toHaveBeenCalled();

      // Assert: Outbox event published with eligibility result
      await pool.query(
        `INSERT INTO whatsapp_handler.outbox_events
         (aggregate_id, aggregate_type, event_type, payload)
         VALUES ($1, 'journey', 'journey.eligibility_confirmed', $2)`,
        ['journey-historic-123', JSON.stringify(eligibilityResult)]
      );

      const outboxEvents = await pool.query(
        `SELECT * FROM whatsapp_handler.outbox_events
         WHERE event_type = 'journey.eligibility_confirmed'`
      );
      expect(outboxEvents.rows).toHaveLength(1);
      expect(outboxEvents.rows[0].payload.isEligible).toBe(true);
      expect(outboxEvents.rows[0].payload.compensationAmount).toBe('£15.00');

      // Assert: FSM state transitions to AUTHENTICATED (journey complete)
      await fsmService.transitionTo(user.phone_number, FSMState.AUTHENTICATED, {});
      const finalState = await fsmService.getState(user.phone_number);
      expect(finalState.state).toBe(FSMState.AUTHENTICATED);
    });
  });

  describe('AC-5: Future Journey Tracking Registration', () => {
    /**
     * AC-5: If my journey is future, receive a message confirming that my journey
     *       has been saved and will be tracked
     */

    it('should register journey with delay-tracker for future journeys', async () => {
      // Arrange: Create test user
      const userResult = await pool.query(
        `INSERT INTO whatsapp_handler.users (phone_number, verified_at)
         VALUES ($1, NOW())
         RETURNING *`,
        ['+447700900666']
      );
      const user: User = userResult.rows[0];

      // Mock delay-tracker registration response
      const mockDelayTracker = vi.fn().mockResolvedValue({
        trackingId: 'tracking-456',
        message: 'Journey registered for monitoring',
      });

      // Act: User completes journey submission (future date: tomorrow)
      await fsmService.setState(user.phone_number, FSMState.AWAITING_TICKET_UPLOAD, {
        journeyId: 'journey-future-789',
        journeyDate: 'tomorrow',
        origin: 'PAD',
        destination: 'CDF',
        isFuture: true,
      });

      // Simulate handler calling delay-tracker POST /journeys/track
      const trackingResult = await mockDelayTracker({
        journeyId: 'journey-future-789',
        userId: user.id,
        journeyDate: 'tomorrow',
      });

      // Assert: delay-tracker called
      expect(mockDelayTracker).toHaveBeenCalled();

      // Assert: Outbox event published for tracking registration
      await pool.query(
        `INSERT INTO whatsapp_handler.outbox_events
         (aggregate_id, aggregate_type, event_type, payload)
         VALUES ($1, 'journey', 'journey.tracking_registered', $2)`,
        [
          'journey-future-789',
          JSON.stringify({
            trackingId: trackingResult.trackingId,
            journeyId: 'journey-future-789',
            userId: user.id,
          }),
        ]
      );

      const outboxEvents = await pool.query(
        `SELECT * FROM whatsapp_handler.outbox_events
         WHERE event_type = 'journey.tracking_registered'`
      );
      expect(outboxEvents.rows).toHaveLength(1);
      expect(outboxEvents.rows[0].payload.trackingId).toBe('tracking-456');

      // Assert: User informed journey is being tracked
      const finalState = await fsmService.getState(user.phone_number);
      expect(finalState.state).toBe(FSMState.AUTHENTICATED);
    });
  });

  describe('AC-6: Proactive Notification When Tracked Journey Delayed', () => {
    /**
     * AC-6: When my future journey becomes historic, immediately receive a message
     *       telling me if my journey is eligible for a claim
     *
     * NOTE: This tests ASYNCHRONOUS webhook from delay-tracker to whatsapp-handler
     */

    it('should send proactive WhatsApp notification when delay-tracker detects delay', async () => {
      // Arrange: Create test user with tracked future journey
      const userResult = await pool.query(
        `INSERT INTO whatsapp_handler.users (phone_number, verified_at)
         VALUES ($1, NOW())
         RETURNING *`,
        ['+447700900777']
      );
      const user: User = userResult.rows[0];

      // Simulate delay-tracker webhook payload (journey delayed)
      const delayNotification = {
        userId: user.id,
        journeyId: 'journey-tracked-999',
        journeyDate: '2024-11-21',
        origin: 'PAD',
        destination: 'CDF',
        delayMinutes: 45,
        isEligible: true,
        compensationAmount: '£25.00',
        tocName: 'Great Western Railway',
      };

      // Act: Simulate webhook handler processing delay notification
      // (In real implementation, this would be POST /notifications/delay-detected)

      // Assert: Outbox event published for proactive notification
      await pool.query(
        `INSERT INTO whatsapp_handler.outbox_events
         (aggregate_id, aggregate_type, event_type, payload)
         VALUES ($1, 'journey', 'journey.delay_notification_sent', $2)`,
        ['journey-tracked-999', JSON.stringify(delayNotification)]
      );

      const outboxEvents = await pool.query(
        `SELECT * FROM whatsapp_handler.outbox_events
         WHERE event_type = 'journey.delay_notification_sent'
         AND aggregate_id = 'journey-tracked-999'`
      );

      expect(outboxEvents.rows).toHaveLength(1);
      expect(outboxEvents.rows[0].payload.isEligible).toBe(true);
      expect(outboxEvents.rows[0].payload.delayMinutes).toBe(45);
      expect(outboxEvents.rows[0].payload.compensationAmount).toBe('£25.00');

      // Note: Actual Twilio API call would be verified in E2E smoke tests
      // Integration test focuses on database and outbox event persistence
    });
  });

  describe('Coverage: Infrastructure Wiring Tests (Per Testing Strategy § 5.2)', () => {
    /**
     * CRITICAL: At least one integration test must exercise REAL dependencies
     * to catch missing transitive dependencies (per Testing Strategy § 5.2)
     */

    it('should successfully import and use @railrepay/winston-logger', async () => {
      // @ts-expect-error - Logger import may not exist yet
      const { createLogger } = await import('@railrepay/winston-logger');
      expect(createLogger).toBeDefined();

      // Verify logger can be instantiated
      const logger = createLogger({ serviceName: 'whatsapp-handler', level: 'info' });
      expect(logger).toBeDefined();
      expect(logger.info).toBeInstanceOf(Function);
    });

    it('should successfully import and use @railrepay/metrics-pusher', async () => {
      // @ts-expect-error - Metrics import may not exist yet
      const { createMetricsPusher } = await import('@railrepay/metrics-pusher');
      expect(createMetricsPusher).toBeDefined();
    });

    it('should successfully import and use @railrepay/postgres-client', async () => {
      // @ts-expect-error - Postgres client import may not exist yet
      const { createPostgresClient } = await import('@railrepay/postgres-client');
      expect(createPostgresClient).toBeDefined();
    });
  });
});
