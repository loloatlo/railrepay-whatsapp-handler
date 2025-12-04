import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMetricsRouter, getMetricsRegistry } from '../../../src/routes/metrics';

describe('Metrics Route', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: ReturnType<typeof vi.fn>;
  let capturedMetrics: string;

  beforeEach(() => {
    capturedMetrics = '';

    mockRequest = {
      method: 'GET',
      path: '/metrics',
    };

    // The shared library uses res.end() instead of res.send()
    // Support both for compatibility
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      send: vi.fn().mockImplementation((data) => {
        capturedMetrics = data;
        return mockResponse;
      }),
      end: vi.fn().mockImplementation((data) => {
        capturedMetrics = data;
        return mockResponse;
      }),
    };

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /metrics - Basic Functionality', () => {
    it('should return 200 with Prometheus metrics', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert - shared library uses res.set() and res.end() instead of status/send
      expect(mockResponse.set).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/plain'));
      expect(capturedMetrics).toBeDefined();
      expect(capturedMetrics.length).toBeGreaterThan(0);
    });

    it('should return metrics in Prometheus format', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('# HELP');
      expect(capturedMetrics).toContain('# TYPE');
    });

    it('should include default Node.js metrics', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('nodejs_version_info');
      expect(capturedMetrics).toContain('process_cpu_user_seconds_total');
      expect(capturedMetrics).toContain('nodejs_heap_size_total_bytes');
    });
  });

  describe('Custom WhatsApp Metrics', () => {
    it('should include whatsapp_messages_received_total counter', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('whatsapp_messages_received_total');
      expect(capturedMetrics).toContain('TYPE whatsapp_messages_received_total counter');
    });

    it('should include whatsapp_messages_sent_total counter', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('whatsapp_messages_sent_total');
      expect(capturedMetrics).toContain('TYPE whatsapp_messages_sent_total counter');
    });

    it('should include whatsapp_user_registrations_total counter', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('whatsapp_user_registrations_total');
      expect(capturedMetrics).toContain('TYPE whatsapp_user_registrations_total counter');
    });

    it('should include whatsapp_otp_verifications_total counter', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('whatsapp_otp_verifications_total');
      expect(capturedMetrics).toContain('TYPE whatsapp_otp_verifications_total counter');
    });

    it('should include whatsapp_journeys_created_total counter', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('whatsapp_journeys_created_total');
      expect(capturedMetrics).toContain('TYPE whatsapp_journeys_created_total counter');
    });

    it('should include whatsapp_webhook_duration_seconds histogram', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('whatsapp_webhook_duration_seconds');
      expect(capturedMetrics).toContain('TYPE whatsapp_webhook_duration_seconds histogram');
    });

    it('should include whatsapp_fsm_transition_duration_seconds histogram', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('whatsapp_fsm_transition_duration_seconds');
      expect(capturedMetrics).toContain('TYPE whatsapp_fsm_transition_duration_seconds histogram');
    });

    it('should include whatsapp_active_sessions_total gauge', async () => {
      // Arrange
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('whatsapp_active_sessions_total');
      expect(capturedMetrics).toContain('TYPE whatsapp_active_sessions_total gauge');
    });
  });

  describe('Metrics Registry Access', () => {
    it('should provide access to registry for incrementing counters', () => {
      // Act
      const registry = getMetricsRegistry();

      // Assert
      expect(registry).toBeDefined();
      expect(registry.metrics).toBeDefined();
    });

    it('should allow incrementing message received counter', async () => {
      // Arrange
      const registry = getMetricsRegistry();
      const router = createMetricsRouter();
      const handler = router.stack[0]?.route?.stack[0]?.handle;

      // Act
      const counter = registry.getSingleMetric('whatsapp_messages_received_total');
      if (counter && 'inc' in counter) {
        (counter as any).inc({ status: 'success' });
      }
      await handler!(mockRequest as Request, mockResponse as Response, mockNext);

      // Assert
      expect(capturedMetrics).toContain('whatsapp_messages_received_total{status="success"}');
    });
  });
});
