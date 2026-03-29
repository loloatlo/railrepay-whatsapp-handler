/**
 * FSM Service Tests — BL-167 New States (TD-WHATSAPP-062-S1)
 *
 * BL-167: TD-WHATSAPP-062-S1 — Core FSM + OCR Call + User Confirmation
 * SPEC: services/whatsapp-handler/docs/phases/TD-WHATSAPP-062-S1-SPECIFICATION.md
 * Per ADR-014: These tests define the behavior. Implementation does not exist yet.
 * Per Test Lock Rule: Blake MUST NOT modify these tests.
 *
 * These tests verify that the two new FSM states introduced in Sub-Story 1:
 *   - AWAITING_TICKET_OR_MANUAL
 *   - AWAITING_OCR_REVIEW
 * are correctly defined in the FSMState enum (src/services/fsm.service.ts).
 *
 * They will FAIL until Blake adds the two enum values.
 */

import { describe, it, expect } from 'vitest';
import { FSMState } from '../../../src/services/fsm.service';

describe('TD-WHATSAPP-062-S1: FSMState enum — new states', () => {
  it('should define AWAITING_TICKET_OR_MANUAL state', () => {
    // AC-1: New FSM state must exist in the enum
    expect(FSMState.AWAITING_TICKET_OR_MANUAL).toBe('AWAITING_TICKET_OR_MANUAL');
  });

  it('should define AWAITING_OCR_REVIEW state', () => {
    // AC-10: OCR review state must exist in the enum
    expect(FSMState.AWAITING_OCR_REVIEW).toBe('AWAITING_OCR_REVIEW');
  });
});
