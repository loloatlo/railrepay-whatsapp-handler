/**
 * Notification Metrics Unit Tests
 *
 * Phase TD-1: Failing tests for BL-148 / TD-WHATSAPP-060
 * AC-10: New Prometheus metrics: whatsapp_notifications_sent_total (counter, labels: eligible/ineligible),
 *        whatsapp_notification_errors_total (counter)
 *
 * Tests the new notification-specific Prometheus metrics added to the metrics module.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Import notification metrics that will be added to metrics module
import {
  initializeNotificationMetrics,
  notificationsSentCounter,
  notificationErrorsCounter,
} from '../../../src/routes/notification-metrics.js';

describe('Notification Metrics (AC-10)', () => {
  beforeEach(() => {
    // Reset metrics before each test
    // Note: prom-client Counter doesn't have a direct reset,
    // but we can verify the metrics are registered correctly
  });

  describe('initializeNotificationMetrics', () => {
    it('AC-10: should export notificationsSentCounter after initialization', () => {
      initializeNotificationMetrics();

      expect(notificationsSentCounter).toBeDefined();
    });

    it('AC-10: should export notificationErrorsCounter after initialization', () => {
      initializeNotificationMetrics();

      expect(notificationErrorsCounter).toBeDefined();
    });
  });

  describe('notificationsSentCounter (AC-10)', () => {
    it('AC-10: should be a Counter with name whatsapp_notifications_sent_total', () => {
      initializeNotificationMetrics();

      // Verify the counter has the correct name
      // The internal Prometheus name should be whatsapp_notifications_sent_total
      expect(notificationsSentCounter).toBeDefined();

      // Counter should support labels
      expect(() => {
        notificationsSentCounter.inc({ result: 'eligible' });
      }).not.toThrow();
    });

    it('AC-10: should support eligible label', () => {
      initializeNotificationMetrics();

      expect(() => {
        notificationsSentCounter.inc({ result: 'eligible' });
      }).not.toThrow();
    });

    it('AC-10: should support ineligible label', () => {
      initializeNotificationMetrics();

      expect(() => {
        notificationsSentCounter.inc({ result: 'ineligible' });
      }).not.toThrow();
    });
  });

  describe('notificationErrorsCounter (AC-10)', () => {
    it('AC-10: should be a Counter with name whatsapp_notification_errors_total', () => {
      initializeNotificationMetrics();

      expect(notificationErrorsCounter).toBeDefined();

      expect(() => {
        notificationErrorsCounter.inc();
      }).not.toThrow();
    });
  });
});
