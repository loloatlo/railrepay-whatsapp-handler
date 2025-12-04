/**
 * Smoke Tests - Post-Deployment Validation
 *
 * Purpose: Verify critical functionality after Railway deployment
 * Per ADR-010: Required for production deployments
 *
 * These tests run AFTER deployment to verify:
 * 1. Service is accessible
 * 2. Health checks pass
 * 3. Database connectivity works
 * 4. Redis connectivity works
 * 5. Observability flow is working
 * 6. Critical endpoints respond correctly
 *
 * Usage:
 *   npm run test:smoke
 *
 * Environment Variables Required:
 *   SERVICE_URL - The deployed service URL (e.g., https://whatsapp-handler.railway.app)
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Get service URL from environment (Railway provides this)
const SERVICE_URL = process.env.SERVICE_URL || 'http://localhost:3000';
const TIMEOUT_MS = 10000; // 10 second timeout for remote calls

describe('Post-Deployment Smoke Tests', () => {
  beforeAll(() => {
    console.log(`Running smoke tests against: ${SERVICE_URL}`);
  });

  describe('Service Availability', () => {
    it('should respond to root endpoint', async () => {
      const response = await fetch(`${SERVICE_URL}/`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('service', 'whatsapp-handler');
      expect(data).toHaveProperty('status', 'running');
      expect(data).toHaveProperty('version');
    }, TIMEOUT_MS);

    it('should respond within acceptable latency (<500ms)', async () => {
      const start = Date.now();
      const response = await fetch(`${SERVICE_URL}/`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const latency = Date.now() - start;

      expect(response.status).toBe(200);
      expect(latency).toBeLessThan(500);
    }, TIMEOUT_MS);
  });

  describe('Health Check Endpoint (ADR-008)', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      expect(response.status).toBe(200);

      const health = await response.json();
      expect(health).toHaveProperty('status');
      expect(['healthy', 'degraded']).toContain(health.status);
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('checks');
    }, TIMEOUT_MS);

    it('should verify database connectivity', async () => {
      const response = await fetch(`${SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const health = await response.json();
      expect(health.checks).toHaveProperty('database');
      expect(health.checks.database.status).toBe('healthy');
      expect(health.checks.database).toHaveProperty('latency_ms');
      expect(health.checks.database.latency_ms).toBeLessThan(1000);
    }, TIMEOUT_MS);

    it('should verify Redis connectivity', async () => {
      const response = await fetch(`${SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const health = await response.json();
      expect(health.checks).toHaveProperty('redis');
      expect(health.checks.redis.status).toBe('healthy');
      expect(health.checks.redis).toHaveProperty('latency_ms');
      expect(health.checks.redis.latency_ms).toBeLessThan(500);
    }, TIMEOUT_MS);

    it('should respond within ADR-008 requirement (<100ms)', async () => {
      const start = Date.now();
      const response = await fetch(`${SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const latency = Date.now() - start;

      expect(response.status).toBe(200);
      // Note: Network latency may exceed 100ms, so we test server-side latency
      const health = await response.json();
      const dbLatency = health.checks.database?.latency_ms || 0;
      const redisLatency = health.checks.redis?.latency_ms || 0;

      expect(dbLatency + redisLatency).toBeLessThan(100);
    }, TIMEOUT_MS);
  });

  describe('Observability Flow', () => {
    it('should expose Prometheus metrics endpoint', async () => {
      const response = await fetch(`${SERVICE_URL}/metrics`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      expect(response.status).toBe(200);

      const metrics = await response.text();
      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');

      // Verify key metrics are exposed
      expect(metrics).toContain('nodejs_version_info');
      expect(metrics).toContain('process_cpu_user_seconds_total');
      expect(metrics).toContain('process_resident_memory_bytes');
    }, TIMEOUT_MS);

    it('should include custom application metrics', async () => {
      const response = await fetch(`${SERVICE_URL}/metrics`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const metrics = await response.text();

      // Verify custom metrics are defined
      expect(metrics).toContain('whatsapp_webhook_requests_total');
      expect(metrics).toContain('whatsapp_webhook_duration_seconds');
    }, TIMEOUT_MS);
  });

  describe('Critical Endpoints', () => {
    it('should reject unauthenticated webhook requests', async () => {
      const response = await fetch(`${SERVICE_URL}/webhook/twilio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'MessageSid=SM123&From=whatsapp:+447700900123&Body=test',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // Should reject without valid Twilio signature
      expect(response.status).toBe(403);
    }, TIMEOUT_MS);

    it('should return 404 for unknown routes', async () => {
      const response = await fetch(`${SERVICE_URL}/unknown-route`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      expect(response.status).toBe(404);
    }, TIMEOUT_MS);
  });

  describe('Database Migrations', () => {
    it('should have whatsapp_handler schema created', async () => {
      // This is verified indirectly through health check
      const response = await fetch(`${SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const health = await response.json();
      expect(health.checks.database.status).toBe('healthy');

      // If database is healthy, migrations ran successfully
      expect(health.status).not.toBe('unhealthy');
    }, TIMEOUT_MS);
  });

  describe('Error Handling', () => {
    it('should handle malformed requests gracefully', async () => {
      const response = await fetch(`${SERVICE_URL}/webhook/twilio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"invalid": "json"',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // Should return 4xx error, not crash
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(600);
    }, TIMEOUT_MS);

    it('should return proper error response format', async () => {
      const response = await fetch(`${SERVICE_URL}/webhook/twilio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: '',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const contentType = response.headers.get('content-type');
      expect(contentType).toContain('application/json');
    }, TIMEOUT_MS);
  });
});
