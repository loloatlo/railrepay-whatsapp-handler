/**
 * FSM Service v2.0 - Finite State Machine for WhatsApp Conversation Flow
 *
 * SPEC: Notion › RailRepay MVP › WhatsApp Message Flow
 * Per ADR-014: Implementation written AFTER tests
 * Per ADR-002: Correlation IDs included in all logs (via winston-logger)
 *
 * DESIGN:
 * - Redis-backed state storage with 24-hour TTL
 * - 11 conversation states (START → AUTHENTICATED → JOURNEY → CLAIM)
 * - State transitions are atomic (Redis SET is atomic)
 * - State data stored as JSON for flexibility
 *
 * STATE LIFECYCLE:
 * - New users start at START state
 * - Redis TTL = 24 hours (auto-cleanup of abandoned conversations)
 * - DELETE state when conversation completes or user opts out
 *
 * REDIS KEY FORMAT: fsm:state:{phoneNumber}
 * Example: fsm:state:+447700900123
 */

import type Redis from 'ioredis';

/**
 * FSM States (11 total)
 * Per specification § WhatsApp Message Flow
 */
export enum FSMState {
  START = 'START', // New user, no prior interaction
  AWAITING_TERMS = 'AWAITING_TERMS', // Terms sent, awaiting YES/NO
  AWAITING_OTP = 'AWAITING_OTP', // OTP sent via Twilio Verify, awaiting code
  AUTHENTICATED = 'AUTHENTICATED', // User verified, main menu
  AWAITING_JOURNEY_DATE = 'AWAITING_JOURNEY_DATE', // Awaiting journey date input
  AWAITING_JOURNEY_STATIONS = 'AWAITING_JOURNEY_STATIONS', // Awaiting FROM/TO stations
  AWAITING_JOURNEY_TIME = 'AWAITING_JOURNEY_TIME', // Awaiting journey time
  AWAITING_JOURNEY_CONFIRM = 'AWAITING_JOURNEY_CONFIRM', // Journey summary shown, awaiting YES/NO
  AWAITING_TICKET_UPLOAD = 'AWAITING_TICKET_UPLOAD', // Awaiting ticket photo
  AWAITING_CLAIM_STATUS = 'AWAITING_CLAIM_STATUS', // User requested status check
  ERROR = 'ERROR', // Invalid state or timeout (recovery state)
}

/**
 * State data structure stored in Redis
 */
export interface FSMStateData {
  state: FSMState;
  data: Record<string, any>; // Flexible state data (e.g., verificationSid, journeyDate, etc.)
}

export class FsmService {
  private readonly STATE_TTL_SECONDS = 86400; // 24 hours
  private readonly STATE_KEY_PREFIX = 'fsm:state:';

  constructor(private redis: Redis) {}

  /**
   * Get current state for a phone number
   *
   * @param phoneNumber - E.164 phone number (e.g., +447700900123)
   * @returns Current state and data, or START state if not found
   */
  async getState(phoneNumber: string): Promise<FSMStateData> {
    const key = this.getStateKey(phoneNumber);

    try {
      const storedValue = await this.redis.get(key);

      if (!storedValue) {
        // No state found - return START
        return {
          state: FSMState.START,
          data: {},
        };
      }

      // Parse stored JSON
      const parsedState: FSMStateData = JSON.parse(storedValue);
      return parsedState;
    } catch (error) {
      // JSON parse error or other issue - return START state
      if (error instanceof SyntaxError) {
        return {
          state: FSMState.START,
          data: {},
        };
      }

      // Re-throw Redis errors
      throw error;
    }
  }

  /**
   * Set state for a phone number
   *
   * @param phoneNumber - E.164 phone number
   * @param state - New FSM state
   * @param data - Optional state data (default: {})
   */
  async setState(phoneNumber: string, state: FSMState, data: Record<string, any> = {}): Promise<void> {
    const key = this.getStateKey(phoneNumber);
    const stateData: FSMStateData = { state, data };

    await this.redis.setex(key, this.STATE_TTL_SECONDS, JSON.stringify(stateData));
  }

  /**
   * Delete state for a phone number
   *
   * USAGE: Call when conversation ends or user opts out
   *
   * @param phoneNumber - E.164 phone number
   */
  async deleteState(phoneNumber: string): Promise<void> {
    const key = this.getStateKey(phoneNumber);
    await this.redis.del(key);
  }

  /**
   * Transition to a new state (convenience method)
   *
   * This method supports merging with previous state data if needed.
   *
   * @param phoneNumber - E.164 phone number
   * @param newState - New FSM state
   * @param newData - New state data
   * @param mergeWithPrevious - If true, merge with existing data (default: false)
   */
  async transitionTo(
    phoneNumber: string,
    newState: FSMState,
    newData: Record<string, any> = {},
    mergeWithPrevious: boolean = false
  ): Promise<void> {
    if (mergeWithPrevious) {
      const currentState = await this.getState(phoneNumber);
      const mergedData = { ...currentState.data, ...newData };
      await this.setState(phoneNumber, newState, mergedData);
    } else {
      await this.setState(phoneNumber, newState, newData);
    }
  }

  /**
   * Generate Redis key for phone number
   *
   * @param phoneNumber - E.164 phone number
   * @returns Redis key (e.g., fsm:state:+447700900123)
   */
  private getStateKey(phoneNumber: string): string {
    return `${this.STATE_KEY_PREFIX}${phoneNumber}`;
  }
}
