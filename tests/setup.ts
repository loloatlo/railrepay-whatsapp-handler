/**
 * Global test setup
 * Sets default environment variables for tests
 */

import { beforeEach } from 'vitest';

// Set default JOURNEY_MATCHER_URL for tests (TD-WHATSAPP-028)
// Individual tests can override by setting process.env.JOURNEY_MATCHER_URL
beforeEach(() => {
  if (!process.env.JOURNEY_MATCHER_URL) {
    process.env.JOURNEY_MATCHER_URL = 'http://localhost:3001';
  }
});
