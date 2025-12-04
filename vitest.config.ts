import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
      // Per ADR-014: TDD coverage thresholds
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
    testTimeout: 60000, // 60s for Testcontainers startup
    hookTimeout: 60000,
  },
});
