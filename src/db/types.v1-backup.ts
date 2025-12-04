/**
 * Database types for whatsapp_handler schema
 * Per specification: users, user_preferences, outbox_events tables
 */

/**
 * User record from whatsapp_handler.users table
 * Per specification §4.2: Phone-based authentication
 */
export interface User {
  id: string; // UUID
  phone_number: string; // E.164 format (+447700900123)
  display_name: string | null;
  verified_at: Date | null;
  registered_at: Date;
  last_active_at: Date | null;
  otp_secret: string | null; // Hashed OTP
  otp_verified_at: Date | null;
  terms_accepted_at: Date | null;
  terms_version: string | null;
  blocked_at: Date | null; // Soft delete timestamp
  block_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Data for creating a new user
 */
export interface CreateUserDTO {
  phone_number: string;
  display_name?: string;
  terms_accepted_at?: Date;
  terms_version?: string;
}

/**
 * Data for updating a user
 */
export interface UpdateUserDTO {
  display_name?: string;
  verified_at?: Date;
  last_active_at?: Date;
  otp_secret?: string;
  otp_verified_at?: Date;
  terms_accepted_at?: Date;
  terms_version?: string;
  blocked_at?: Date;
  block_reason?: string;
}

/**
 * User preferences record from whatsapp_handler.user_preferences table
 * Per specification §4.3: User settings
 */
export interface UserPreferences {
  id: string; // UUID
  user_id: string; // FK to users.id
  notification_enabled: boolean;
  language: string; // Default: 'en-GB'
  timezone: string; // Default: 'Europe/London'
  delay_threshold_minutes: number; // Default: 15 (minimum compensation threshold)
  auto_claim_enabled: boolean; // Default: true
  created_at: Date;
  updated_at: Date;
}

/**
 * Data for creating user preferences
 */
export interface CreateUserPreferencesDTO {
  user_id: string;
  notification_enabled?: boolean;
  language?: string;
  timezone?: string;
  delay_threshold_minutes?: number;
  auto_claim_enabled?: boolean;
}

/**
 * Data for updating user preferences
 */
export interface UpdateUserPreferencesDTO {
  notification_enabled?: boolean;
  language?: string;
  timezone?: string;
  delay_threshold_minutes?: number;
  auto_claim_enabled?: boolean;
}

/**
 * Outbox event record from whatsapp_handler.outbox_events table
 * Per specification §4.4: Transactional outbox pattern
 */
export interface OutboxEvent {
  id: string; // UUID
  aggregate_id: string; // User ID or related entity ID
  aggregate_type: string; // 'user', 'conversation', 'ticket'
  event_type: string; // 'user.registered', 'user.verified', etc.
  event_version: string; // Default: '1.0'
  payload: Record<string, any>; // JSONB event payload
  metadata: Record<string, any> | null; // Optional metadata
  correlation_id: string; // For distributed tracing
  created_at: Date;
  published_at: Date | null; // NULL = unpublished
}

/**
 * Data for creating an outbox event
 */
export interface CreateOutboxEventDTO {
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  event_version?: string;
  payload: Record<string, any>;
  metadata?: Record<string, any>;
  correlation_id: string;
}

/**
 * Event types published by whatsapp-handler
 * Per specification §4.4
 */
export enum EventType {
  USER_REGISTERED = 'user.registered',
  USER_VERIFIED = 'user.verified',
  CONVERSATION_STARTED = 'conversation.started',
  TICKET_UPLOADED = 'ticket.uploaded',
}

/**
 * Aggregate types for outbox events
 */
export enum AggregateType {
  USER = 'user',
  CONVERSATION = 'conversation',
  TICKET = 'ticket',
}
