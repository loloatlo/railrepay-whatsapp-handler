/**
 * Journey Eligibility Handler Tests - Written FIRST per ADR-014 (TDD)
 *
 * USER STORY: Submitting a Journey to RailRepay
 * ACCEPTANCE CRITERIA: AC-4, AC-5, AC-6
 *
 * AC-4: If my journey is historic, immediately receive a message telling me if
 *       my journey is eligible for a claim
 * AC-5: If my journey is future, receive a message confirming that my journey
 *       has been saved and will be tracked
 * AC-6: When my future journey becomes historic, immediately receive a message
 *       telling me if my journey is eligible for a claim
 *
 * CONTEXT: This tests NEW integration with eligibility-engine and delay-tracker.
 * Per Jessie's Test Specification Guidelines (Phase 3.1), these tests are:
 * - Behavior-focused (test WHAT the system should do, not HOW)
 * - Interface-based (mock service boundaries: eligibility-engine, delay-tracker)
 * - Runnable from Day 1 (will fail until Blake implements in Phase 3.2)
 * - No placeholder assertions (all assertions are completable)
 *
 * INTEGRATION POINTS:
 * - eligibility-engine service: POST /eligibility/evaluate (returns eligibility result)
 * - delay-tracker service: POST /journeys/track (registers future journey for monitoring)
 * - whatsapp-handler outbox: Publishes events for proactive notifications (AC-6)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';
import type { HandlerContext } from '../../../src/handlers';
import type { User } from '../../../src/db/types';

/**
 * IMPORT NOTE: This handler DOES NOT exist yet - Blake will create it
 * This test file will initially have import errors - that's expected
 */
// @ts-expect-error - Handler does not exist yet, Blake will create
import { journeyEligibilityHandler } from '../../../src/handlers/journey-eligibility.handler';

describe('US-XXX: Submitting a Journey to RailRepay', () => {
  describe('AC-4: Historic Journey Immediate Eligibility Check', () => {
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

      /**
       * CONTEXT: User has submitted journey details (date, origin, destination, time)
       * Journey date is in the past (historic journey)
       * System needs to immediately check eligibility via eligibility-engine
       */
      mockContext = {
        phoneNumber: '+447700900123',
        messageBody: 'YES', // User confirmed ticket upload (or skipped)
        messageSid: 'SM123',
        user: mockUser,
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'test-corr-id',
        stateData: {
          // Default historic eligible journey data (can be overridden per test)
          journeyId: 'journey-789',
          travelDate: '2024-11-19', // Yesterday (historic)
          origin: 'PAD',
          destination: 'CDF',
          departureTime: '10:00',
        },
      };
    });

    describe('When journey is historic (past date)', () => {
      it('should immediately check eligibility via eligibility-engine after ticket upload', async () => {
        /**
         * BEHAVIOR: User submits historic journey (yesterday)
         * After ticket upload (or SKIP), system calls eligibility-engine
         * eligibility-engine queries delay data and returns eligibility result
         * System sends immediate response to user
         */
        // Arrange: Historic journey with delay data and eligible response
        const historicEligibleContext = {
          ...mockContext,
          messageBody: 'SKIP', // User skipped ticket upload
          stateData: {
            journeyId: 'journey-789',
            travelDate: '2024-11-19', // Yesterday (historic)
            origin: 'PAD',
            destination: 'CDF',
            departureTime: '10:00',
          },
          // Mock eligibility-engine response (Blake will create service mock)
          mockEligibilityResponse: {
            eligible: true,
            delayMinutes: 35,
            compensationAmount: '£12.50',
            compensationPercentage: 25,
          },
        };

        // Act: User completes ticket upload or skips
        const result = await journeyEligibilityHandler(historicEligibleContext);

        // Assert: Response contains eligibility result
        expect(result.response).toContain('eligible');
        expect(result.response).toContain('£'); // Compensation amount mentioned
        expect(result.response).toContain('claim');

        // Assert: Transitions to next appropriate state (AUTHENTICATED or completion)
        expect([FSMState.AUTHENTICATED, FSMState.START]).toContain(result.nextState);

        // Assert: Outbox event published for claim creation
        expect(result.publishEvents).toBeDefined();
        expect(result.publishEvents?.length).toBeGreaterThan(0);
        expect(result.publishEvents?.[0].event_type).toBe('journey.eligibility_confirmed');
      });

      it('should inform user when journey IS eligible for compensation', async () => {
        // Arrange: Mock eligibility-engine returns eligible result
        const eligibleContext = {
          ...mockContext,
          stateData: {
            journeyId: 'journey-eligible-123',
            travelDate: '2024-11-19', // Historic
            origin: 'PAD',
            destination: 'CDF',
            departureTime: '14:30',
          },
          mockEligibilityResponse: {
            eligible: true,
            delayMinutes: 45,
            compensationAmount: '£15.00',
            compensationPercentage: 25,
          },
        };

        // Act
        const result = await journeyEligibilityHandler(eligibleContext);

        // Assert: Message confirms eligibility
        expect(result.response).toMatch(/good news|eligible|qualify/i);
        expect(result.response).toContain('delay');
        expect(result.response).toContain('minutes');
      });

      it('should inform user when journey IS NOT eligible for compensation', async () => {
        // Arrange: Mock eligibility-engine returns ineligible result
        // (Journey delayed but under threshold, or TOC doesn't compensate)
        const ineligibleContext = {
          ...mockContext,
          stateData: {
            journeyId: 'journey-ineligible-456',
            travelDate: '2024-11-19', // Historic
            origin: 'PAD',
            destination: 'CDF',
            departureTime: '08:00',
          },
          mockEligibilityResponse: {
            eligible: false,
            delayMinutes: 10, // Under 15-minute threshold
            ineligibilityReason: 'Delay under minimum threshold (15 minutes)',
          },
        };

        // Act
        const result = await journeyEligibilityHandler(ineligibleContext);

        // Assert: Message explains ineligibility
        expect(result.response).toMatch(/not eligible|does not qualify|sorry/i);
        expect(result.response).toContain('delay');
      });

      it('should include compensation amount when journey is eligible', async () => {
        // Arrange: Eligible journey with calculated compensation
        const compensationContext = {
          ...mockContext,
          stateData: {
            journeyId: 'journey-compensation-789',
            travelDate: '2024-11-19',
            origin: 'PAD',
            destination: 'CDF',
            departureTime: '18:15',
          },
          mockEligibilityResponse: {
            eligible: true,
            delayMinutes: 60,
            compensationAmount: '£25.00',
            compensationPercentage: 50,
          },
        };

        // Act
        const result = await journeyEligibilityHandler(compensationContext);

        // Assert: Response includes specific compensation amount
        expect(result.response).toMatch(/£\d+\.?\d*/); // Currency amount format
        expect(result.response).toMatch(/\d+%/); // Percentage (e.g., "25% of ticket price")
      });

      it('should handle eligibility-engine service unavailable gracefully', async () => {
        /**
         * BEHAVIOR: If eligibility-engine is down or times out,
         * system should inform user and retry later (don't lose journey)
         */
        // Arrange: Mock eligibility-engine timeout
        const serviceUnavailableContext = {
          ...mockContext,
          stateData: {
            journeyId: 'journey-timeout-999',
            travelDate: '2024-11-19',
            origin: 'PAD',
            destination: 'CDF',
            departureTime: '12:00',
          },
          mockEligibilityResponse: {
            serviceUnavailable: true,
          },
        };

        // Act
        const result = await journeyEligibilityHandler(serviceUnavailableContext);

        // Assert: User informed of temporary issue
        expect(result.response).toContain('check');
        expect(result.response).toContain('later');

        // Assert: Journey data persisted for retry
        expect(result.stateData?.eligibilityCheckPending).toBe(true);

        // Assert: Returns to authenticated state (user can continue using service)
        expect(result.nextState).toBe(FSMState.AUTHENTICATED);
      });
    });

    describe('When journey has no delay data available', () => {
      it('should inform user that eligibility cannot be determined yet', async () => {
        /**
         * SCENARIO: Journey date is recent (yesterday) but darwin-ingestor
         * hasn't received delay data from Rail Data Marketplace yet
         */
        const noDelayDataContext = {
          ...mockContext,
          stateData: {
            journeyId: 'journey-nodata-111',
            travelDate: '2024-11-19', // Recent but no data yet
            origin: 'PAD',
            destination: 'CDF',
            departureTime: '22:00',
          },
          mockEligibilityResponse: {
            eligible: null,
            delayDataAvailable: false,
          },
        };

        // Act
        const result = await journeyEligibilityHandler(noDelayDataContext);

        // Assert: Message explains delay data not available yet
        expect(result.response).toContain('check');
        expect(result.response).toContain('data');
        expect(result.response).toMatch(/not.*available|processing/i);

        // Assert: Journey saved for later evaluation
        expect(result.stateData?.delayDataPending).toBe(true);
      });
    });
  });

  describe('AC-5: Future Journey Tracking Confirmation', () => {
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

      /**
       * CONTEXT: User has submitted journey details for a FUTURE journey
       * System needs to register journey with delay-tracker for monitoring
       */
      mockContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP', // User skipped ticket upload (will upload later)
        messageSid: 'SM123',
        user: mockUser,
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'test-corr-id',
        stateData: {
          // Default future journey data
          journeyId: 'journey-future-890',
          travelDate: '2024-11-21', // Tomorrow (future)
          origin: 'PAD',
          destination: 'CDF',
          departureTime: '10:00',
        },
      };
    });

    describe('When journey is future (not yet happened)', () => {
      it('should register journey with delay-tracker for monitoring', async () => {
        /**
         * BEHAVIOR: User submits future journey (tomorrow)
         * System calls delay-tracker POST /journeys/track
         * delay-tracker begins monitoring darwin-ingestor for delay data
         * System confirms to user that journey is being tracked
         */
        // Arrange: Future journey with tracking success response
        const futureTrackingContext = {
          ...mockContext,
          messageBody: 'SKIP',
          stateData: {
            journeyId: 'journey-future-890',
            travelDate: '2024-11-21', // Tomorrow (future)
            origin: 'PAD',
            destination: 'CDF',
            departureTime: '10:00',
          },
          mockDelayTrackerResponse: {
            registered: true,
            trackingId: 'track-abc123',
          },
        };

        // Act: User completes journey submission
        const result = await journeyEligibilityHandler(futureTrackingContext);

        // Assert: Confirmation message sent
        expect(result.response).toContain('saved');
        expect(result.response).toContain('track');
        expect(result.response).toContain('monitor');

        // Assert: Transitions to authenticated state (user can submit more journeys)
        expect(result.nextState).toBe(FSMState.AUTHENTICATED);

        // Assert: Outbox event published for delay-tracker registration
        expect(result.publishEvents).toBeDefined();
        expect(result.publishEvents?.length).toBeGreaterThan(0);
        expect(result.publishEvents?.[0].event_type).toBe('journey.tracking_registered');
      });

      it('should inform user they will be notified when delay is detected', async () => {
        // Arrange: Future journey context
        const futureNotificationContext = {
          ...mockContext,
          stateData: {
            journeyId: 'journey-future-notify-555',
            travelDate: '2024-11-22', // Day after tomorrow
            origin: 'BHM',
            destination: 'MAN',
            departureTime: '15:30',
          },
          mockDelayTrackerResponse: {
            registered: true,
            trackingId: 'track-notify-555',
          },
        };

        // Act
        const result = await journeyEligibilityHandler(futureNotificationContext);

        // Assert: Message explains proactive notification
        expect(result.response).toContain('notify');
        expect(result.response).toContain('delay');
        expect(result.response).toMatch(/let you know|message you|inform you/i);
      });

      it('should include journey details in confirmation message', async () => {
        // Arrange: Future journey with specific details
        const detailsContext = {
          ...mockContext,
          stateData: {
            journeyId: 'journey-details-777',
            travelDate: '2024-11-21', // Tomorrow
            origin: 'PAD',
            destination: 'CDF',
            departureTime: '10:00',
          },
          mockDelayTrackerResponse: {
            registered: true,
            trackingId: 'track-777',
          },
        };

        // Act
        const result = await journeyEligibilityHandler(detailsContext);

        // Assert: Confirmation includes journey summary
        expect(result.response).toContain('PAD');
        expect(result.response).toContain('CDF');
        expect(result.response).toMatch(/21.*Nov|tomorrow/i); // Date mentioned
      });

      it('should handle delay-tracker service unavailable gracefully', async () => {
        /**
         * BEHAVIOR: If delay-tracker is down, journey is still saved in
         * journey-matcher but tracking registration is retried later
         */
        // Arrange: Mock delay-tracker timeout
        const trackerUnavailableContext = {
          ...mockContext,
          stateData: {
            journeyId: 'journey-tracker-down-999',
            travelDate: '2024-11-21',
            origin: 'PAD',
            destination: 'CDF',
            departureTime: '10:00',
          },
          mockDelayTrackerResponse: {
            serviceUnavailable: true,
          },
        };

        // Act
        const result = await journeyEligibilityHandler(trackerUnavailableContext);

        // Assert: User informed journey is saved
        expect(result.response).toContain('saved');

        // Assert: Warning about tracking delay (optional)
        // System should retry tracking registration asynchronously

        // Assert: Journey persisted with tracking_pending flag
        expect(result.stateData?.trackingPending).toBe(true);
      });
    });
  });

  describe('AC-6: Proactive Notification When Future Journey Becomes Historic', () => {
    /**
     * NOTE: This acceptance criterion tests ASYNCHRONOUS behavior.
     * The notification is NOT triggered by user input - it's triggered by
     * delay-tracker detecting a delay after the journey date has passed.
     *
     * TESTING APPROACH:
     * - Unit test: Verify message formatting handler exists
     * - Integration test: Verify delay-tracker → whatsapp-handler webhook flow
     * - E2E test: Verify end-to-end proactive notification delivery
     */

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

      /**
       * CONTEXT: delay-tracker detected delay for previously-registered future journey
       * delay-tracker called eligibility-engine to evaluate claim
       * delay-tracker now calling whatsapp-handler webhook to notify user
       */
      mockContext = {
        phoneNumber: '+447700900123',
        messageBody: '', // No user input - this is a PUSH notification
        messageSid: 'SM-SYSTEM-GENERATED',
        user: mockUser,
        currentState: FSMState.AUTHENTICATED, // User not actively in conversation
        correlationId: 'test-corr-id',
      };
    });

    describe('When delay-tracker detects delay for tracked journey', () => {
      it('should send proactive notification to user via Twilio', async () => {
        /**
         * BEHAVIOR: delay-tracker calls whatsapp-handler webhook endpoint
         * POST /notifications/delay-detected
         * whatsapp-handler sends WhatsApp message via Twilio API
         * Message is NOT part of FSM conversation (proactive outbound)
         */
        // Arrange: Mock webhook payload from delay-tracker
        const delayNotification = {
          userId: 'user-123',
          journeyId: 'journey-890',
          journeyDate: '2024-11-21',
          origin: 'PAD',
          destination: 'CDF',
          delayMinutes: 45,
          isEligible: true,
          compensationAmount: '£25.00',
        };

        // Act: Simulate webhook handler processing delay notification
        // @ts-expect-error - Function does not exist yet, Blake will create
        const result = await journeyEligibilityHandler.sendDelayNotification(
          mockUser,
          delayNotification
        );

        // Assert: Message sent via Twilio (verified by mock or spy)
        expect(result).toBeDefined();
        expect(result.messageBody).toContain('delay');
        expect(result.messageBody).toContain('PAD');
        expect(result.messageBody).toContain('CDF');
        expect(result.messageBody).toContain('45');
        expect(result.messageBody).toContain('eligible');
        expect(result.messageBody).toContain('£25.00');

        // Assert: Message includes call-to-action
        expect(result.messageBody).toMatch(/reply|claim|submit/i);
      });

      it('should include eligibility result in proactive notification', async () => {
        // Arrange
        const eligibleNotification = {
          userId: 'user-123',
          journeyId: 'journey-890',
          isEligible: true,
          compensationAmount: '£15.50',
        };

        // Act
        // @ts-expect-error - Function does not exist yet
        const result = await journeyEligibilityHandler.sendDelayNotification(
          mockUser,
          eligibleNotification
        );

        // Assert: Good news message
        expect(result.messageBody).toMatch(/good news|eligible/i);
        expect(result.messageBody).toContain('£15.50');
      });

      it('should inform user when tracked journey had delay but is NOT eligible', async () => {
        // Arrange: Delay under threshold or other ineligibility reason
        const ineligibleNotification = {
          userId: 'user-123',
          journeyId: 'journey-890',
          isEligible: false,
          delayMinutes: 10, // Under 15-minute threshold
          ineligibilityReason: 'Delay under minimum threshold (15 minutes)',
        };

        // Act
        // @ts-expect-error - Function does not exist yet
        const result = await journeyEligibilityHandler.sendDelayNotification(
          mockUser,
          ineligibleNotification
        );

        // Assert: Informative message explaining ineligibility
        expect(result.messageBody).toContain('delay');
        expect(result.messageBody).toContain('10');
        expect(result.messageBody).toMatch(/not eligible|does not qualify/i);
        expect(result.messageBody).toContain('15 minutes'); // Threshold explanation
      });

      it('should not send notification if user has opted out of notifications', async () => {
        /**
         * BEHAVIOR: Check user_preferences table for notification opt-out
         * If opted out, skip notification but log the event
         */
        // Arrange: Mock user with notification_enabled = false preference

        // Act
        // @ts-expect-error - Function does not exist yet
        const result = await journeyEligibilityHandler.sendDelayNotification(
          {
            ...mockUser,
            notificationOptedOut: true, // User has opted out of notifications
          },
          { userId: 'user-123', journeyId: 'journey-890', isEligible: true }
        );

        // Assert: No message sent
        expect(result).toBeNull();
      });

      it('should handle Twilio API failure gracefully and retry', async () => {
        /**
         * BEHAVIOR: If Twilio API returns error, notification should be
         * queued for retry (idempotent delivery via outbox pattern)
         */
        // Arrange: Mock Twilio API failure

        // Act
        // @ts-expect-error - Function does not exist yet
        const result = await journeyEligibilityHandler.sendDelayNotification(
          mockUser,
          { userId: 'user-123', journeyId: 'journey-890', isEligible: true, twilioFail: true }
        );

        // Assert: Error handled, retry scheduled
        expect(result.retryScheduled).toBe(true);

        // Assert: Error logged for monitoring
        // (Winston log spy would verify this in integration test)
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle journey with exactly 15 minutes delay (eligibility threshold)', async () => {
      /**
       * BOUNDARY CASE: Most TOCs have 15-minute threshold for compensation
       * Test that 15 minutes is treated as eligible (>= threshold)
       */
      // Arrange: Journey with exactly 15 minutes delay
      const mockUser: User = {
        id: 'user-boundary',
        phone_number: '+447700900123',
        verified_at: new Date('2024-11-20T10:00:00Z'),
        created_at: new Date('2024-11-20T10:00:00Z'),
        updated_at: new Date('2024-11-20T10:00:00Z'),
      };

      const exactThresholdContext: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM123',
        user: mockUser,
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'test-corr-id',
        stateData: {
          journeyId: 'journey-15min-threshold',
          travelDate: '2024-11-19',
          origin: 'PAD',
          destination: 'RDG',
          departureTime: '10:00',
        },
        mockEligibilityResponse: {
          eligible: true,
          delayMinutes: 15, // Exactly at threshold
          compensationAmount: '£10.00',
          compensationPercentage: 25,
        },
      };

      // Act
      const result = await journeyEligibilityHandler(exactThresholdContext);

      // Assert: 15 minutes meets threshold
      expect(result.response).toMatch(/eligible|qualify/i);
    });

    it('should handle journey with 14 minutes delay (under threshold)', async () => {
      // Arrange: Journey with 14 minutes delay (under threshold)
      const mockUser: User = {
        id: 'user-boundary',
        phone_number: '+447700900123',
        verified_at: new Date('2024-11-20T10:00:00Z'),
        created_at: new Date('2024-11-20T10:00:00Z'),
        updated_at: new Date('2024-11-20T10:00:00Z'),
      };

      const underThresholdContext: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM123',
        user: mockUser,
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'test-corr-id',
        stateData: {
          journeyId: 'journey-14min-under',
          travelDate: '2024-11-19',
          origin: 'PAD',
          destination: 'RDG',
          departureTime: '10:00',
        },
        mockEligibilityResponse: {
          eligible: false,
          delayMinutes: 14, // Under threshold
          ineligibilityReason: 'Delay under minimum threshold (15 minutes)',
        },
      };

      // Act
      const result = await journeyEligibilityHandler(underThresholdContext);

      // Assert: 14 minutes is ineligible
      expect(result.response).toMatch(/not eligible|does not qualify/i);
    });

    it('should handle missing journey data in state gracefully', async () => {
      /**
       * ERROR CASE: State machine corruption or lost data
       */
      // Arrange: Context with no journey data in state
      const mockUser: User = {
        id: 'user-error',
        phone_number: '+447700900123',
        verified_at: new Date('2024-11-20T10:00:00Z'),
        created_at: new Date('2024-11-20T10:00:00Z'),
        updated_at: new Date('2024-11-20T10:00:00Z'),
      };

      const missingDataContext: HandlerContext = {
        phoneNumber: '+447700900123',
        messageBody: 'SKIP',
        messageSid: 'SM123',
        user: mockUser,
        currentState: FSMState.AWAITING_TICKET_UPLOAD,
        correlationId: 'test-corr-id',
        // NO stateData - this is the error case
      };

      // Act
      const result = await journeyEligibilityHandler(missingDataContext);

      // Assert: Error state transition
      expect(result.nextState).toBe(FSMState.ERROR);
      expect(result.response).toContain('error');
    });
  });
});
