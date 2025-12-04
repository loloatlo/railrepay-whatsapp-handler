/**
 * Type definitions for whatsapp-handler service
 *
 * Per Notion › Data Layer § whatsapp_handler
 * Schema: whatsapp_handler
 */

/**
 * User entity from whatsapp_handler.users table
 * Per specification Section 4.2
 */
export interface User {
  id: string;
  phone_number: string;
  display_name: string | null;
  verified_at: Date | null;
  registered_at: Date;
  last_active_at: Date | null;
  otp_secret: string | null;
  otp_verified_at: Date | null;
  terms_accepted_at: Date | null;
  terms_version: string | null;
  blocked_at: Date | null;
  block_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * User preferences entity from whatsapp_handler.user_preferences table
 * Per specification Section 4.3
 */
export interface UserPreferences {
  id: string;
  user_id: string;
  notification_enabled: boolean;
  language: string;
  timezone: string;
  delay_threshold_minutes: number;
  auto_claim_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Outbox event entity from whatsapp_handler.outbox_events table
 * Per specification Section 4.4
 */
export interface OutboxEvent {
  id: string;
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  event_version: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  correlation_id: string;
  created_at: Date;
  published_at: Date | null;
}

/**
 * FSM states for conversation flow
 * Per specification Appendix B
 */
export enum FsmState {
  START = 'START',
  AWAITING_TERMS = 'AWAITING_TERMS',
  AWAITING_OTP = 'AWAITING_OTP',
  AUTHENTICATED = 'AUTHENTICATED',
  JOURNEY_CAPTURE_DATE = 'JOURNEY_CAPTURE_DATE',
  JOURNEY_CAPTURE_STATIONS = 'JOURNEY_CAPTURE_STATIONS',
  JOURNEY_CAPTURE_TIME = 'JOURNEY_CAPTURE_TIME',
  JOURNEY_CAPTURE_CONFIRM = 'JOURNEY_CAPTURE_CONFIRM',
  TICKET_UPLOAD = 'TICKET_UPLOAD',
  CLAIM_SUBMITTED = 'CLAIM_SUBMITTED',
}

/**
 * Twilio webhook payload
 * Per specification Section 3.1
 */
export interface TwilioWebhookPayload {
  MessageSid: string;
  From: string; // Format: whatsapp:+447700900123
  To: string; // Format: whatsapp:+14155238886
  Body: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
}

/**
 * Health check response
 * Per specification Section 3.2
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: 'healthy' | 'unhealthy';
    redis: 'healthy' | 'unhealthy';
    twilio?: 'healthy' | 'unhealthy';
  };
  version: string;
}

/**
 * Event types for outbox pattern
 * Per specification Section 4.4
 */
export enum EventType {
  USER_REGISTERED = 'user.registered',
  USER_VERIFIED = 'user.verified',
  CONVERSATION_STARTED = 'conversation.started',
  TICKET_UPLOADED = 'ticket.uploaded',
}

/**
 * DTO for creating a user
 */
export interface CreateUserDTO {
  phone_number: string;
  display_name?: string | null;
  registered_at?: Date;
}

/**
 * DTO for updating a user
 */
export interface UpdateUserDTO {
  display_name?: string | null;
  verified_at?: Date | null;
  last_active_at?: Date | null;
  otp_secret?: string | null;
  otp_verified_at?: Date | null;
  terms_accepted_at?: Date | null;
  terms_version?: string | null;
  blocked_at?: Date | null;
  block_reason?: string | null;
}

/**
 * DTO for creating user preferences
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
 * DTO for updating user preferences
 */
export interface UpdateUserPreferencesDTO {
  notification_enabled?: boolean;
  language?: string;
  timezone?: string;
  delay_threshold_minutes?: number;
  auto_claim_enabled?: boolean;
}

/**
 * DTO for creating outbox events
 */
export interface CreateOutboxEventDTO {
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  event_version?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  correlation_id: string;
}

/**
 * Custom error classes
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}
