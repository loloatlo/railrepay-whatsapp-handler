/**
 * TD-WHATSAPP-058: FSM State Enum — New States
 *
 * TD CONTEXT: Three new FSM states are added by this TD to support the manual
 * ticket collection flow when a user SKIPs ticket upload.
 *
 * NEW STATES:
 *   AWAITING_TICKET_PRICE  - After SKIP at ticket upload, collect ticket cost
 *   AWAITING_TICKET_CLASS  - After valid price, collect Standard or First class
 *   AWAITING_TICKET_TYPE   - After valid class, collect Advance/Anytime/Off-Peak/Super Off-Peak
 *
 * This brings the total FSMState count from 13 to 16.
 *
 * Phase TD-1: Test Specification (Jessie)
 * These tests MUST FAIL initially - no implementation exists yet.
 * Blake will add 3 enum values to src/services/fsm.service.ts in Phase TD-2.
 *
 * Test Lock Rule: Blake MUST NOT modify these tests.
 * Per ADR-014 (TDD), per ADR-004 (Vitest).
 *
 * Acceptance Criteria covered:
 * AC-1: New FSM states AWAITING_TICKET_PRICE, AWAITING_TICKET_CLASS, AWAITING_TICKET_TYPE added
 */

import { describe, it, expect } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';

describe('TD-WHATSAPP-058: FSMState enum — new ticket collection states', () => {
  // ---------------------------------------------------------------------------
  // AC-1: New enum values exist and have correct string values
  // ---------------------------------------------------------------------------
  describe('AC-1: AWAITING_TICKET_PRICE state exists', () => {
    it('should define AWAITING_TICKET_PRICE state', () => {
      // AC-1: State must exist in the enum — will FAIL until Blake adds it
      expect(FSMState.AWAITING_TICKET_PRICE).toBeDefined();
    });

    it('should have string value "AWAITING_TICKET_PRICE"', () => {
      // AC-1: Value follows existing naming convention (uppercase snake_case)
      expect(FSMState.AWAITING_TICKET_PRICE).toBe('AWAITING_TICKET_PRICE');
    });
  });

  describe('AC-1: AWAITING_TICKET_CLASS state exists', () => {
    it('should define AWAITING_TICKET_CLASS state', () => {
      // AC-1: State must exist in the enum — will FAIL until Blake adds it
      expect(FSMState.AWAITING_TICKET_CLASS).toBeDefined();
    });

    it('should have string value "AWAITING_TICKET_CLASS"', () => {
      // AC-1: Value follows existing naming convention
      expect(FSMState.AWAITING_TICKET_CLASS).toBe('AWAITING_TICKET_CLASS');
    });
  });

  describe('AC-1: AWAITING_TICKET_TYPE state exists', () => {
    it('should define AWAITING_TICKET_TYPE state', () => {
      // AC-1: State must exist in the enum — will FAIL until Blake adds it
      expect(FSMState.AWAITING_TICKET_TYPE).toBeDefined();
    });

    it('should have string value "AWAITING_TICKET_TYPE"', () => {
      // AC-1: Value follows existing naming convention
      expect(FSMState.AWAITING_TICKET_TYPE).toBe('AWAITING_TICKET_TYPE');
    });
  });

  describe('AC-1: Total FSM state count is now 16 (updated to 18 by TD-WHATSAPP-062-S1)', () => {
    it('should have exactly 18 FSM states after adding ticket collection states (TD-058) and OCR states (TD-062-S1)', () => {
      // AC-1: Verifies all 3 new states were added by TD-058 (13 existing + 3 new = 16)
      // TD-WHATSAPP-062-S1 (BL-167) subsequently added AWAITING_TICKET_OR_MANUAL and AWAITING_OCR_REVIEW,
      // bringing the total to 18.
      // Counts unique string values in the enum
      const stateValues = Object.values(FSMState);
      expect(stateValues).toHaveLength(18);
    });

    it('should include all original 13 states unchanged', () => {
      // AC-1: Regression — adding new states must not remove or rename existing ones
      expect(FSMState.START).toBe('START');
      expect(FSMState.AWAITING_TERMS).toBe('AWAITING_TERMS');
      expect(FSMState.AWAITING_OTP).toBe('AWAITING_OTP');
      expect(FSMState.AUTHENTICATED).toBe('AUTHENTICATED');
      expect(FSMState.AWAITING_JOURNEY_DATE).toBe('AWAITING_JOURNEY_DATE');
      expect(FSMState.AWAITING_JOURNEY_STATIONS).toBe('AWAITING_JOURNEY_STATIONS');
      expect(FSMState.AWAITING_JOURNEY_TIME).toBe('AWAITING_JOURNEY_TIME');
      expect(FSMState.AWAITING_JOURNEY_CONFIRM).toBe('AWAITING_JOURNEY_CONFIRM');
      expect(FSMState.AWAITING_ROUTING_CONFIRM).toBe('AWAITING_ROUTING_CONFIRM');
      expect(FSMState.AWAITING_ROUTING_ALTERNATIVE).toBe('AWAITING_ROUTING_ALTERNATIVE');
      expect(FSMState.AWAITING_TICKET_UPLOAD).toBe('AWAITING_TICKET_UPLOAD');
      expect(FSMState.AWAITING_CLAIM_STATUS).toBe('AWAITING_CLAIM_STATUS');
      expect(FSMState.ERROR).toBe('ERROR');
    });

    it('should include all 3 new ticket collection states', () => {
      // AC-1: All three new states together
      expect(FSMState.AWAITING_TICKET_PRICE).toBe('AWAITING_TICKET_PRICE');
      expect(FSMState.AWAITING_TICKET_CLASS).toBe('AWAITING_TICKET_CLASS');
      expect(FSMState.AWAITING_TICKET_TYPE).toBe('AWAITING_TICKET_TYPE');
    });
  });

  describe('AC-1: FSM flow ordering — new states follow AWAITING_TICKET_UPLOAD in the flow', () => {
    it('should have AWAITING_TICKET_PRICE as a distinct state from AWAITING_TICKET_UPLOAD', () => {
      // AC-1: The two states are different — SKIP at UPLOAD enters PRICE
      expect(FSMState.AWAITING_TICKET_PRICE).not.toBe(FSMState.AWAITING_TICKET_UPLOAD);
    });

    it('should have AWAITING_TICKET_CLASS as a distinct state from AWAITING_TICKET_PRICE', () => {
      // AC-1: Sequential states — each step is distinct
      expect(FSMState.AWAITING_TICKET_CLASS).not.toBe(FSMState.AWAITING_TICKET_PRICE);
    });

    it('should have AWAITING_TICKET_TYPE as a distinct state from AWAITING_TICKET_CLASS', () => {
      // AC-1: Third step is distinct from second step
      expect(FSMState.AWAITING_TICKET_TYPE).not.toBe(FSMState.AWAITING_TICKET_CLASS);
    });

    it('should have all three new states distinct from each other', () => {
      // AC-1: No value collision between the three new states
      const newStates = [
        FSMState.AWAITING_TICKET_PRICE,
        FSMState.AWAITING_TICKET_CLASS,
        FSMState.AWAITING_TICKET_TYPE,
      ];
      const uniqueStates = new Set(newStates);
      expect(uniqueStates.size).toBe(3);
    });
  });
});
