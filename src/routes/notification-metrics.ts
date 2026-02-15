/**
 * Notification Metrics
 *
 * BL-148: Prometheus metrics for proactive notification feature.
 *
 * AC-10: New Prometheus metrics:
 *   - whatsapp_notifications_sent_total (counter, labels: eligible/ineligible)
 *   - whatsapp_notification_errors_total (counter)
 *
 * Per ADR-006: Push-based metrics via MetricsPusher
 */

import {
  getRegistry,
  Counter,
} from '@railrepay/metrics-pusher';

/**
 * Metrics initialization flag
 */
let notificationMetricsInitialized = false;

/**
 * Notification metrics - exported for use in handlers
 */
export let notificationsSentCounter: Counter<'result'>;
export let notificationErrorsCounter: Counter<string>;

/**
 * Initialize notification metrics
 * Registers notification-specific counters with shared Prometheus registry
 *
 * Must be called after initializeMetrics() from routes/metrics.ts
 */
export function initializeNotificationMetrics(): void {
  if (notificationMetricsInitialized) {
    return;
  }

  const registry = getRegistry();

  // AC-10: Notifications sent counter with eligible/ineligible labels
  notificationsSentCounter = new Counter({
    name: 'whatsapp_notifications_sent_total',
    help: 'Total number of proactive WhatsApp notifications sent',
    labelNames: ['result'] as const,
    registers: [registry],
  });

  // AC-10: Notification errors counter
  notificationErrorsCounter = new Counter({
    name: 'whatsapp_notification_errors_total',
    help: 'Total number of proactive notification errors',
    registers: [registry],
  });

  notificationMetricsInitialized = true;
}

/**
 * Reset notification metrics (for testing)
 */
export function resetNotificationMetrics(): void {
  notificationMetricsInitialized = false;
}
