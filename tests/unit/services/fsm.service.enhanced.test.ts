/**
 * FSM Service Enhanced Tests - New States for Journey Routing
 * Written FIRST per ADR-014 (TDD)
 *
 * USER STORY: Submitting a Journey to RailRepay
 * ACCEPTANCE CRITERIA: AC-2, AC-3 (Routing confirmation workflow)
 *
 * CONTEXT: Tests new FSM states required for complex journey routing:
 * - AWAITING_ROUTING_CONFIRM: User must confirm suggested routing
 * - AWAITING_ROUTING_ALTERNATIVE: User selecting from alternative routes
 *
 * These states DO NOT exist in current codebase. Blake will add them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FsmService, FSMState } from '../../../src/services/fsm.service';
import type { FSMStateData } from '../../../src/services/fsm.service';
import type Redis from 'ioredis';

describe('FSM Service - Enhanced States for Journey Routing', () => {
  let fsmService: FsmService;
  let mockRedis: Redis;

  beforeEach(() => {
    // Mock Redis client using Vitest (matching fsm.service.test.ts pattern)
    // CORRECTED: Was incorrectly using real Redis connection in unit test
    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      ttl: vi.fn(),
      flushdb: vi.fn(),
      quit: vi.fn(),
    } as unknown as Redis;

    fsmService = new FsmService(mockRedis);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('New FSMState enum values', () => {
    it('should include AWAITING_ROUTING_CONFIRM state in FSMState enum', () => {
      /**
       * TEST: Verify new state exists in enum
       * Blake must add: AWAITING_ROUTING_CONFIRM = 'AWAITING_ROUTING_CONFIRM'
       */
      expect(FSMState).toHaveProperty('AWAITING_ROUTING_CONFIRM');
      expect(FSMState.AWAITING_ROUTING_CONFIRM).toBe('AWAITING_ROUTING_CONFIRM');
    });

    it('should include AWAITING_ROUTING_ALTERNATIVE state in FSMState enum', () => {
      /**
       * TEST: Verify new state exists in enum
       * Blake must add: AWAITING_ROUTING_ALTERNATIVE = 'AWAITING_ROUTING_ALTERNATIVE'
       */
      expect(FSMState).toHaveProperty('AWAITING_ROUTING_ALTERNATIVE');
      expect(FSMState.AWAITING_ROUTING_ALTERNATIVE).toBe('AWAITING_ROUTING_ALTERNATIVE');
    });
  });

  /**
   * SIMPLIFIED: State transition logic is already fully tested in fsm.service.test.ts
   * This test file focuses ONLY on verifying new enum values exist.
   * Complex state transition tests removed to avoid needing real Redis in unit tests.
   */
  describe('State transitions for routing workflow', () => {
    it('should allow setting AWAITING_ROUTING_CONFIRM state via setState', async () => {
      /**
       * TEST: Verify new state can be set (basic FSM functionality)
       */
      const phoneNumber = '+447700900123';
      const journeyData = {
        journeyId: 'journey-123',
        suggestedRoute: { legs: [] },
      };

      await fsmService.setState(phoneNumber, FSMState.AWAITING_ROUTING_CONFIRM, journeyData);

      // Assert: setex called with correct state
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `fsm:state:${phoneNumber}`,
        86400,
        expect.stringContaining('AWAITING_ROUTING_CONFIRM')
      );
    });

    it('should allow setting AWAITING_ROUTING_ALTERNATIVE state via setState', async () => {
      /**
       * TEST: Verify new state can be set (basic FSM functionality)
       */
      const phoneNumber = '+447700900456';
      const alternativeData = {
        alternativeCount: 1,
        alternatives: [],
      };

      await fsmService.setState(phoneNumber, FSMState.AWAITING_ROUTING_ALTERNATIVE, alternativeData);

      // Assert: setex called with correct state
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `fsm:state:${phoneNumber}`,
        86400,
        expect.stringContaining('AWAITING_ROUTING_ALTERNATIVE')
      );
    });
  });
});
