/**
 * HTTP Client Utility Tests - Written FIRST per ADR-014 (TDD)
 *
 * TD-WHATSAPP-041: Retry/Circuit Breaker for Serverless Cold-Starts
 *
 * TD CONTEXT: External HTTP calls to Railway-hosted services (journey-matcher) may fail
 * due to serverless cold-start latency. Single timeout causes poor UX when downstream
 * service was simply waking up.
 *
 * REQUIRED FIX: Create shared HTTP client with:
 * - Retry logic (3 attempts with exponential backoff: 1s, 2s, 4s)
 * - Circuit breaker pattern (prevent cascading failures)
 * - Configurable timeouts
 *
 * Per Jessie's Test Specification Guidelines (Phase 3.1):
 * - Behavior-focused (test WHAT the client should do, not HOW)
 * - Runnable from Day 1 (will fail until Blake implements)
 * - No placeholder assertions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { AxiosError } from 'axios';

// Mock axios
vi.mock('axios');
import axios from 'axios';

// Mock winston logger (infrastructure package mocking per Section 6.1.11)
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// Import the http-client (will fail until Blake creates it in TD-2)
// @ts-expect-error - File does not exist yet, Blake will create
import { createHttpClient } from '../../../src/utils/http-client';

describe('TD-WHATSAPP-041: HTTP Client with Retry and Circuit Breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fake timers for exponential backoff testing
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Successful requests', () => {
    it('should make successful HTTP GET request on first try without retry', async () => {
      // Arrange
      const mockResponse = { data: { success: true }, status: 200 };
      vi.mocked(axios.get).mockResolvedValue(mockResponse);

      const client = createHttpClient();

      // Act
      const result = await client.get('http://test.example.com/api');

      // Assert: Called once (no retry needed)
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true });
    });

    it('should include default timeout of 15000ms', async () => {
      // Arrange
      vi.mocked(axios.get).mockResolvedValue({ data: {}, status: 200 });
      const client = createHttpClient();

      // Act
      await client.get('http://test.example.com/api');

      // Assert: Timeout configured
      expect(axios.get).toHaveBeenCalledWith(
        'http://test.example.com/api',
        expect.objectContaining({
          timeout: 15000,
        })
      );
    });

    it('should allow custom timeout configuration', async () => {
      // Arrange
      vi.mocked(axios.get).mockResolvedValue({ data: {}, status: 200 });
      const client = createHttpClient({ timeout: 5000 });

      // Act
      await client.get('http://test.example.com/api');

      // Assert: Custom timeout used
      expect(axios.get).toHaveBeenCalledWith(
        'http://test.example.com/api',
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });

    it('should pass correlation ID in request headers when provided', async () => {
      // Arrange
      vi.mocked(axios.get).mockResolvedValue({ data: {}, status: 200 });
      const client = createHttpClient();

      // Act
      await client.get('http://test.example.com/api', {
        headers: { 'X-Correlation-ID': 'test-corr-123' },
      });

      // Assert: Correlation ID passed through
      expect(axios.get).toHaveBeenCalledWith(
        'http://test.example.com/api',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'test-corr-123',
          }),
        })
      );
    });
  });

  describe('Retry logic with exponential backoff', () => {
    it('should retry after first failure and succeed on second attempt (was: single failure caused total failure)', async () => {
      // Arrange: First call fails (cold-start), second succeeds
      vi.mocked(axios.get)
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce({ data: { success: true }, status: 200 });

      const client = createHttpClient({ retries: 3, retryDelay: 1000 });

      // Act
      const resultPromise = client.get('http://test.example.com/api');

      // Fast-forward through retry delay (1 second)
      await vi.advanceTimersByTimeAsync(1000);

      const result = await resultPromise;

      // Assert: Retried once and succeeded
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });

    it('should use exponential backoff timing (1s, 2s, 4s for default 1000ms retryDelay)', async () => {
      /**
       * EXPONENTIAL BACKOFF:
       * Attempt 1: Immediate
       * Attempt 2: Wait 1s (1000ms * 2^0)
       * Attempt 3: Wait 2s (1000ms * 2^1)
       * Attempt 4: Wait 4s (1000ms * 2^2)
       */
      // Arrange: Fail 3 times, succeed on 4th
      vi.mocked(axios.get)
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'))
        .mockResolvedValueOnce({ data: { success: true }, status: 200 });

      const client = createHttpClient({ retries: 3, retryDelay: 1000 });

      // Act & Assert: Track timing of retry attempts
      const resultPromise = client.get('http://test.example.com/api');

      // First attempt: immediate failure
      await vi.advanceTimersByTimeAsync(0);
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Second attempt: after 1s delay
      await vi.advanceTimersByTimeAsync(1000);
      expect(axios.get).toHaveBeenCalledTimes(2);

      // Third attempt: after 2s delay (cumulative: 3s)
      await vi.advanceTimersByTimeAsync(2000);
      expect(axios.get).toHaveBeenCalledTimes(3);

      // Fourth attempt: after 4s delay (cumulative: 7s)
      await vi.advanceTimersByTimeAsync(4000);
      expect(axios.get).toHaveBeenCalledTimes(4);

      const result = await resultPromise;
      expect(result).toEqual({ success: true });
    });

    it('should fail after max retries exhausted (default 3 retries = 4 total attempts)', async () => {
      // Arrange: All attempts fail
      const error = new Error('Service unavailable');
      vi.mocked(axios.get).mockRejectedValue(error);

      const client = createHttpClient({ retries: 3, retryDelay: 1000 });

      // Act & Assert
      const resultPromise = client.get('http://test.example.com/api');

      // Advance through all retry delays
      await vi.advanceTimersByTimeAsync(1000); // Retry 1
      await vi.advanceTimersByTimeAsync(2000); // Retry 2
      await vi.advanceTimersByTimeAsync(4000); // Retry 3

      await expect(resultPromise).rejects.toThrow('Service unavailable');

      // Assert: 4 total attempts (1 initial + 3 retries)
      expect(axios.get).toHaveBeenCalledTimes(4);
    });

    it('should allow configurable retry count', async () => {
      // Arrange: Configure for only 1 retry (2 total attempts)
      vi.mocked(axios.get).mockRejectedValue(new Error('Fail'));

      const client = createHttpClient({ retries: 1, retryDelay: 500 });

      // Act
      const resultPromise = client.get('http://test.example.com/api');
      await vi.advanceTimersByTimeAsync(500); // Single retry delay

      await expect(resultPromise).rejects.toThrow('Fail');

      // Assert: 2 total attempts (1 initial + 1 retry)
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should log retry attempts with correlation ID for observability', async () => {
      // Arrange
      vi.mocked(axios.get)
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ data: { success: true }, status: 200 });

      const client = createHttpClient({ retries: 3, retryDelay: 1000 });

      // Act
      const resultPromise = client.get('http://test.example.com/api', {
        headers: { 'X-Correlation-ID': 'retry-test-corr' },
      });

      await vi.advanceTimersByTimeAsync(1000);
      await resultPromise;

      // Assert: Logger called for retry attempt
      expect(sharedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Retrying'),
        expect.objectContaining({
          attempt: 2,
          url: 'http://test.example.com/api',
        })
      );
    });
  });

  describe('Circuit breaker pattern', () => {
    it('should open circuit after threshold consecutive failures (default 5)', async () => {
      /**
       * CIRCUIT BREAKER STATES:
       * - CLOSED: Normal operation, requests pass through
       * - OPEN: After N failures, reject requests immediately without calling service
       * - HALF-OPEN: After cooldown, allow one test request
       */
      // Arrange: Mock 5 consecutive failures to trigger circuit breaker
      vi.mocked(axios.get).mockRejectedValue(new Error('Service down'));

      const client = createHttpClient({
        retries: 0, // No retries to make test faster
        circuitBreakerThreshold: 5,
      });

      // Act: Make 5 requests to trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        await expect(client.get('http://test.example.com/api')).rejects.toThrow();
      }

      // Assert: Circuit is now OPEN - 6th request should fail immediately WITHOUT calling axios
      const axiosCallsBefore = vi.mocked(axios.get).mock.calls.length;
      await expect(client.get('http://test.example.com/api')).rejects.toThrow('Circuit breaker is OPEN');
      const axiosCallsAfter = vi.mocked(axios.get).mock.calls.length;

      expect(axiosCallsAfter).toBe(axiosCallsBefore); // No additional axios call made
    });

    it('should transition to HALF-OPEN state after cooldown period (default 30s)', async () => {
      // Arrange: Open the circuit with 5 failures
      vi.mocked(axios.get).mockRejectedValue(new Error('Service down'));

      const client = createHttpClient({
        retries: 0,
        circuitBreakerThreshold: 5,
        circuitBreakerCooldown: 30000, // 30 seconds
      });

      // Trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        await expect(client.get('http://test.example.com/api')).rejects.toThrow();
      }

      // Circuit is OPEN - requests fail immediately
      await expect(client.get('http://test.example.com/api')).rejects.toThrow('Circuit breaker is OPEN');

      // Act: Fast-forward cooldown period
      await vi.advanceTimersByTimeAsync(30000);

      // Circuit transitions to HALF-OPEN - next request is allowed through
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { recovered: true }, status: 200 });

      const result = await client.get('http://test.example.com/api');

      // Assert: Request succeeded, circuit should close
      expect(result).toEqual({ recovered: true });
    });

    it('should close circuit after successful request in HALF-OPEN state', async () => {
      // Arrange: Open circuit, wait for cooldown, make successful request
      vi.mocked(axios.get).mockRejectedValue(new Error('Service down'));

      const client = createHttpClient({
        retries: 0,
        circuitBreakerThreshold: 5,
        circuitBreakerCooldown: 30000,
      });

      // Open circuit
      for (let i = 0; i < 5; i++) {
        await expect(client.get('http://test.example.com/api')).rejects.toThrow();
      }

      // Cooldown
      await vi.advanceTimersByTimeAsync(30000);

      // Successful request in HALF-OPEN
      vi.mocked(axios.get).mockResolvedValue({ data: { success: true }, status: 200 });
      await client.get('http://test.example.com/api');

      // Act: Make another request - should go through (circuit CLOSED)
      const result = await client.get('http://test.example.com/api');

      // Assert: Request succeeded, circuit is CLOSED
      expect(result).toEqual({ success: true });
    });

    it('should re-open circuit if request fails in HALF-OPEN state', async () => {
      // Arrange: Open circuit, wait for cooldown, fail the test request
      vi.mocked(axios.get).mockRejectedValue(new Error('Service down'));

      const client = createHttpClient({
        retries: 0,
        circuitBreakerThreshold: 5,
        circuitBreakerCooldown: 30000,
      });

      // Open circuit
      for (let i = 0; i < 5; i++) {
        await expect(client.get('http://test.example.com/api')).rejects.toThrow();
      }

      // Cooldown
      await vi.advanceTimersByTimeAsync(30000);

      // Act: Request fails in HALF-OPEN state
      await expect(client.get('http://test.example.com/api')).rejects.toThrow('Service down');

      // Assert: Circuit re-opens, next request fails immediately
      const axiosCallsBefore = vi.mocked(axios.get).mock.calls.length;
      await expect(client.get('http://test.example.com/api')).rejects.toThrow('Circuit breaker is OPEN');
      const axiosCallsAfter = vi.mocked(axios.get).mock.calls.length;

      expect(axiosCallsAfter).toBe(axiosCallsBefore); // No axios call made
    });

    it('should allow configurable circuit breaker threshold', async () => {
      // Arrange: Configure threshold of 3 failures
      vi.mocked(axios.get).mockRejectedValue(new Error('Service down'));

      const client = createHttpClient({
        retries: 0,
        circuitBreakerThreshold: 3, // Custom threshold
      });

      // Act: Make 3 requests to trigger circuit breaker
      for (let i = 0; i < 3; i++) {
        await expect(client.get('http://test.example.com/api')).rejects.toThrow();
      }

      // Assert: 4th request should fail immediately (circuit OPEN)
      await expect(client.get('http://test.example.com/api')).rejects.toThrow('Circuit breaker is OPEN');
    });

    it('should log circuit state transitions for observability', async () => {
      // Arrange
      vi.mocked(axios.get).mockRejectedValue(new Error('Service down'));

      const client = createHttpClient({
        retries: 0,
        circuitBreakerThreshold: 5,
      });

      // Act: Trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        await expect(client.get('http://test.example.com/api')).rejects.toThrow();
      }

      // Assert: Logger called when circuit opens
      expect(sharedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker opened'),
        expect.objectContaining({
          threshold: 5,
        })
      );
    });
  });

  describe('POST request support', () => {
    it('should support POST requests with retry and circuit breaker', async () => {
      // Arrange
      vi.mocked(axios.post).mockResolvedValue({ data: { created: true }, status: 201 });

      const client = createHttpClient();

      // Act
      const result = await client.post('http://test.example.com/api', { name: 'Test' });

      // Assert
      expect(axios.post).toHaveBeenCalledWith(
        'http://test.example.com/api',
        { name: 'Test' },
        expect.objectContaining({
          timeout: 15000,
        })
      );
      expect(result).toEqual({ created: true });
    });

    it('should retry POST requests on failure', async () => {
      // Arrange
      vi.mocked(axios.post)
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({ data: { created: true }, status: 201 });

      const client = createHttpClient({ retries: 3, retryDelay: 1000 });

      // Act
      const resultPromise = client.post('http://test.example.com/api', { name: 'Test' });
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      // Assert: Retried and succeeded
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ created: true });
    });
  });

  describe('Error types that should NOT trigger retry', () => {
    it('should NOT retry on 4xx client errors (user error, not transient)', async () => {
      /**
       * RETRY POLICY:
       * - Retry: Network errors, 5xx server errors, timeouts (transient)
       * - NO retry: 4xx client errors (bad request, auth failure - not transient)
       */
      // Arrange: 400 Bad Request
      const clientError: Partial<AxiosError> = {
        response: { status: 400, data: { error: 'Invalid request' } } as any,
        isAxiosError: true,
      };
      vi.mocked(axios.get).mockRejectedValue(clientError);

      const client = createHttpClient({ retries: 3, retryDelay: 1000 });

      // Act
      await expect(client.get('http://test.example.com/api')).rejects.toMatchObject({
        response: { status: 400 },
      });

      // Assert: No retry attempted
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('should retry on 5xx server errors (transient failures)', async () => {
      // Arrange: 503 Service Unavailable (transient)
      const serverError: Partial<AxiosError> = {
        response: { status: 503, data: { error: 'Service unavailable' } } as any,
        isAxiosError: true,
      };
      vi.mocked(axios.get)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ data: { success: true }, status: 200 });

      const client = createHttpClient({ retries: 3, retryDelay: 1000 });

      // Act
      const resultPromise = client.get('http://test.example.com/api');
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      // Assert: Retried on 5xx error
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });
  });
});
