/**
 * Database types for whatsapp_handler schema v2.0 (SIMPLIFIED)
 * Per RFC-whatsapp-handler-schema-v2.md
 *
 * Schema: whatsapp_handler
 * Tables: users (5 columns), user_preferences (6 columns), outbox_events (7 columns)
 *
 * ADR Compliance:
 * - ADR-001: Schema-per-service isolation
 * - ADR-014: TDD (tests define these types)
 */

/**
 * User record from whatsapp_handler.users table (v2.0 - SIMPLIFIED)
 *
 * DESIGN RATIONALE (v2.0):
 * - OTP verification moved to Twilio Verify API (no otp_secret)
 * - Display name removed (not needed for phone-based auth)
 * - Terms acceptance removed (handled by claim-dispatcher service)
 * - Activity tracking removed (24hr Redis TTL for FSM state)
 * - Only 5 columns total
 *
 * Per RAILREPAY-001, RAILREPAY-002
 */
export interface User {
  id: string; // UUID (gen_random_uuid())
  phone_number: string; // E.164 format (+447700900123), UNIQUE
  verified_at: Date | null; // NULL until Twilio Verify callback completes
  created_at: Date; // Auto-set by NOW()
  updated_at: Date; // Auto-updated by NOW()
}

/**
 * Data for creating a new user (v2.0)
 * Only phone_number is required
 */
export interface CreateUserDTO {
  phone_number: string; // Must be E.164 format
}

/**
 * Data for updating a user (v2.0)
 * Only verified_at can be updated (set by Twilio Verify callback)
 */
export interface UpdateUserDTO {
  verified_at?: Date | null;
}

/**
 * User preferences record from whatsapp_handler.user_preferences table (v2.0)
 *
 * DESIGN: Key-value store for flexibility (no ALTER TABLE migrations needed)
 *
 * Per RFC § 2.2: Simplified to key-value pairs instead of typed columns
 */
export interface UserPreference {
  id: string; // UUID
  user_id: string; // FK to users.id (CASCADE DELETE)
  preference_key: string; // e.g., 'language', 'notification_enabled'
  preference_value: string; // TEXT (application validates values)
  created_at: Date;
  updated_at: Date;
}

/**
 * Data for creating a user preference
 */
export interface CreateUserPreferenceDTO {
  user_id: string;
  preference_key: string;
  preference_value: string;
}

/**
 * Data for updating a user preference
 */
export interface UpdateUserPreferenceDTO {
  preference_value: string;
}

/**
 * Outbox event record from whatsapp_handler.outbox_events table (v2.0 - SIMPLIFIED)
 *
 * DESIGN RATIONALE (v2.0):
 * - No event_version (YAGNI - add when multiple versions exist)
 * - No metadata (YAGNI - not needed at MVP scale)
 * - No correlation_id (YAGNI - add when distributed tracing implemented)
 * - Only 7 columns total (down from 10 in v1.0)
 *
 * Per RFC § 2.3: Simplified outbox for MVP
 */
export interface OutboxEvent {
  id: string; // UUID
  aggregate_id: string; // User ID or related entity ID
  aggregate_type: 'user' | 'journey' | 'claim'; // CHECK constraint
  event_type: string; // e.g., 'user.registered', 'user.verified'
  payload: Record<string, any>; // JSONB event payload
  published_at: Date | null; // NULL = unpublished
  created_at: Date; // Auto-set by NOW()
}

/**
 * Data for creating an outbox event (v2.0)
 */
export interface CreateOutboxEventDTO {
  aggregate_id: string;
  aggregate_type: 'user' | 'journey' | 'claim';
  event_type: string;
  payload: Record<string, any>;
}

/**
 * Event types published by whatsapp-handler (v2.0)
 * Per specification § WhatsApp Message Templates
 */
export enum EventType {
  // User lifecycle events
  USER_REGISTERED = 'user.registered', // New user created (phone_number)
  USER_VERIFIED = 'user.verified', // Twilio Verify callback success (verified_at set)

  // Journey events (placeholder for future)
  JOURNEY_CREATED = 'journey.created', // User confirmed journey details
}

/**
 * Aggregate types for outbox events (v2.0)
 * Enforced by CHECK constraint in database
 */
export enum AggregateType {
  USER = 'user',
  JOURNEY = 'journey',
  CLAIM = 'claim',
}
