/**
 * HTTP Client with Retry and Circuit Breaker
 *
 * TD-WHATSAPP-041: Resilience for Railway serverless cold-starts
 *
 * Features:
 * - Exponential backoff retry (1s, 2s, 4s)
 * - Circuit breaker pattern (prevents cascading failures)
 * - Configurable timeouts
 * - Smart error differentiation (retry 5xx, don't retry 4xx)
 *
 * Per ADR-014: Implementation written AFTER tests
 */

import axios, { AxiosRequestConfig } from 'axios';
import { createLogger } from '@railrepay/winston-logger';

export interface HttpClientConfig {
  timeout: number;
  retries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldown: number;
}

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number | null;
}

const defaultConfig: HttpClientConfig = {
  timeout: 15000, // 15 seconds
  retries: 3,
  retryDelay: 1000, // 1 second base delay
  circuitBreakerThreshold: 5,
  circuitBreakerCooldown: 30000, // 30 seconds
};

export function createHttpClient(config?: Partial<HttpClientConfig>) {
  const finalConfig: HttpClientConfig = { ...defaultConfig, ...config };
  const logger = createLogger({ serviceName: 'whatsapp-handler' });

  // Circuit breaker state (shared across all requests)
  const circuitBreakerState: CircuitBreakerState = {
    state: CircuitState.CLOSED,
    failureCount: 0,
    lastFailureTime: null,
  };

  /**
   * Check if circuit breaker should allow request
   */
  function checkCircuitBreaker(): void {
    if (circuitBreakerState.state === CircuitState.OPEN) {
      // Check if cooldown period has elapsed
      const now = Date.now();
      if (
        circuitBreakerState.lastFailureTime &&
        now - circuitBreakerState.lastFailureTime >= finalConfig.circuitBreakerCooldown
      ) {
        // Transition to HALF-OPEN (allow one test request)
        circuitBreakerState.state = CircuitState.HALF_OPEN;
        logger.info('Circuit breaker transitioned to HALF_OPEN', {
          cooldownMs: finalConfig.circuitBreakerCooldown,
        });
      } else {
        // Circuit is still OPEN, reject immediately
        throw new Error('Circuit breaker is OPEN');
      }
    }
  }

  /**
   * Record successful request (reset circuit breaker)
   */
  function recordSuccess(): void {
    if (circuitBreakerState.state === CircuitState.HALF_OPEN) {
      // Successful request in HALF_OPEN state -> close circuit
      circuitBreakerState.state = CircuitState.CLOSED;
      circuitBreakerState.failureCount = 0;
      logger.info('Circuit breaker closed after successful request');
    } else if (circuitBreakerState.state === CircuitState.CLOSED) {
      // Reset failure count on success
      circuitBreakerState.failureCount = 0;
    }
  }

  /**
   * Record failed request (increment circuit breaker)
   */
  function recordFailure(): void {
    circuitBreakerState.failureCount++;
    circuitBreakerState.lastFailureTime = Date.now();

    if (circuitBreakerState.state === CircuitState.HALF_OPEN) {
      // Failed in HALF_OPEN -> re-open circuit
      circuitBreakerState.state = CircuitState.OPEN;
      logger.warn('Circuit breaker re-opened after HALF_OPEN failure', {
        threshold: finalConfig.circuitBreakerThreshold,
      });
    } else if (circuitBreakerState.failureCount >= finalConfig.circuitBreakerThreshold) {
      // Exceeded threshold -> open circuit
      circuitBreakerState.state = CircuitState.OPEN;
      logger.warn('Circuit breaker opened', {
        threshold: finalConfig.circuitBreakerThreshold,
        failureCount: circuitBreakerState.failureCount,
      });
    }
  }

  /**
   * Determine if error should trigger retry
   */
  function shouldRetry(error: any): boolean {
    // Don't retry 4xx client errors (bad request, auth failure, etc.)
    if (error.response?.status >= 400 && error.response?.status < 500) {
      return false;
    }

    // Retry on 5xx server errors, network errors, timeouts
    return true;
  }

  /**
   * Perform a single HTTP call and return the response data.
   * Returns a Promise that never rejects — on failure it returns the error as a resolved value
   * so that callers can chain `.then` without triggering unhandled-rejection warnings.
   */
  function attemptRequest<T>(
    method: 'get' | 'post',
    url: string,
    data: any,
    axiosConfig: AxiosRequestConfig
  ): Promise<{ ok: true; data: T } | { ok: false; error: any }> {
    const call =
      method === 'get'
        ? axios.get<T>(url, axiosConfig)
        : axios.post<T>(url, data, axiosConfig);

    return call
      .then((response) => ({ ok: true as const, data: response.data }))
      .catch((error) => ({ ok: false as const, error }));
  }

  /**
   * Execute HTTP request with retry and circuit breaker.
   * Uses recursive tail-call style to keep all rejections within a single
   * promise chain, avoiding spurious UnhandledPromiseRejection warnings
   * when fake timers advance mid-retry in tests.
   */
  function executeRequest<T>(
    method: 'get' | 'post',
    url: string,
    data?: any,
    options?: AxiosRequestConfig,
    attempt: number = 1
  ): Promise<T> {
    // Check circuit breaker before attempting request
    try {
      checkCircuitBreaker();
    } catch (cbError) {
      return Promise.reject(cbError);
    }

    const axiosConfig: AxiosRequestConfig = {
      ...options,
      timeout: finalConfig.timeout,
      headers: {
        ...options?.headers,
      },
    };

    return attemptRequest<T>(method, url, data, axiosConfig).then((result) => {
      if (result.ok) {
        recordSuccess();
        return result.data;
      }

      const error = result.error;

      // Don't retry 4xx client errors
      if (!shouldRetry(error)) {
        recordFailure();
        return Promise.reject(error);
      }

      // Last attempt exhausted
      if (attempt > finalConfig.retries) {
        recordFailure();
        return Promise.reject(error);
      }

      // Log retry attempt
      logger.warn('Retrying', {
        attempt: attempt + 1,
        url,
        error: error.message,
        delayMs: finalConfig.retryDelay * Math.pow(2, attempt - 1),
      });

      // Exponential backoff: delay * 2^(attempt-1)
      const delay = finalConfig.retryDelay * Math.pow(2, attempt - 1);
      return new Promise<T>((resolve, reject) => {
        setTimeout(() => {
          executeRequest<T>(method, url, data, options, attempt + 1)
            .then(resolve)
            .catch(reject);
        }, delay);
      });
    });
  }

  return {
    async get<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
      return executeRequest<T>('get', url, undefined, options);
    },

    async post<T>(url: string, data: any, options?: AxiosRequestConfig): Promise<T> {
      return executeRequest<T>('post', url, data, options);
    },
  };
}
