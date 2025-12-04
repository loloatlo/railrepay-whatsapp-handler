/**
 * Metrics Route and Registry
 *
 * Uses @railrepay/metrics-pusher for Prometheus metrics collection and push
 * Per SOPs: Use shared libraries for observability (TD-WHATSAPP-011)
 *
 * ADR Compliance:
 * - ADR-006: Push-based metrics via MetricsPusher
 */

import {
  createMetricsRouter as createSharedMetricsRouter,
  getRegistry,
  Counter,
  Histogram,
  Gauge,
} from '@railrepay/metrics-pusher';
import { collectDefaultMetrics } from 'prom-client';
import { getLogger } from '../lib/logger.js';

const logger = getLogger();

/**
 * Metrics initialization flag
 */
let metricsInitialized = false;

/**
 * Custom WhatsApp metrics - exported for use in handlers
 */
export let messagesReceivedCounter: Counter<'status'>;
export let messagesSentCounter: Counter<'status'>;
export let userRegistrationsCounter: Counter<'status'>;
export let otpVerificationsCounter: Counter<'status'>;
export let journeysCreatedCounter: Counter<string>;
export let webhookDurationHistogram: Histogram<string>;
export let fsmTransitionDurationHistogram: Histogram<string>;
export let activeSessionsGauge: Gauge<string>;

/**
 * Initialize metrics - registers all custom metrics with shared registry
 * Must be called before using any metric counters
 */
export function initializeMetrics(): void {
  if (metricsInitialized) {
    return;
  }

  const registry = getRegistry();

  // Collect default Node.js metrics
  collectDefaultMetrics({ register: registry });

  // Custom WhatsApp metrics - Counters
  messagesReceivedCounter = new Counter({
    name: 'whatsapp_messages_received_total',
    help: 'Total number of WhatsApp messages received',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  messagesSentCounter = new Counter({
    name: 'whatsapp_messages_sent_total',
    help: 'Total number of WhatsApp messages sent',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  userRegistrationsCounter = new Counter({
    name: 'whatsapp_user_registrations_total',
    help: 'Total number of user registrations',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  otpVerificationsCounter = new Counter({
    name: 'whatsapp_otp_verifications_total',
    help: 'Total number of OTP verifications',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  journeysCreatedCounter = new Counter({
    name: 'whatsapp_journeys_created_total',
    help: 'Total number of journeys created',
    registers: [registry],
  });

  // Histograms
  webhookDurationHistogram = new Histogram({
    name: 'whatsapp_webhook_duration_seconds',
    help: 'Duration of webhook request processing',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [registry],
  });

  fsmTransitionDurationHistogram = new Histogram({
    name: 'whatsapp_fsm_transition_duration_seconds',
    help: 'Duration of FSM state transitions',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [registry],
  });

  // Gauges
  activeSessionsGauge = new Gauge({
    name: 'whatsapp_active_sessions_total',
    help: 'Total number of active user sessions',
    registers: [registry],
  });

  metricsInitialized = true;
  logger.info('Metrics initialized', {
    component: 'whatsapp-handler/metrics',
  });
}

/**
 * Get metrics registry (for backward compatibility)
 * @returns Prometheus registry from shared library
 */
export function getMetricsRegistry() {
  if (!metricsInitialized) {
    initializeMetrics();
  }
  return getRegistry();
}

/**
 * Creates the metrics router using shared library
 * @returns Express router with metrics endpoint
 */
export function createMetricsRouter() {
  // Initialize metrics if not already done
  if (!metricsInitialized) {
    initializeMetrics();
  }

  // Use shared library's router
  return createSharedMetricsRouter(logger);
}

/**
 * Reset metrics registry (for testing)
 */
export function resetMetricsRegistry(): void {
  // Note: The shared library doesn't expose a reset function
  // This is a no-op for backward compatibility with tests
  metricsInitialized = false;
}
