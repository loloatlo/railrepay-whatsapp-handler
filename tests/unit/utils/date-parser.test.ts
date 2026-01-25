/**
 * Date Parser Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 4. Date/Time Parsing Utilities
 * Per ADR-014: These tests define the parsing behavior
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseDate } from '../../../src/utils/date-parser';

describe('Date Parser', () => {
  beforeEach(() => {
    // Mock current date to 2024-11-20 for consistent tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-11-20T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Relative dates', () => {
    it('should parse "today" to current date', () => {
      const result = parseDate('today');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.date.toISOString().split('T')[0]).toBe('2024-11-20');
      }
    });

    it('should parse "yesterday" to previous day', () => {
      const result = parseDate('yesterday');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.date.toISOString().split('T')[0]).toBe('2024-11-19');
      }
    });

    it('should be case insensitive for relative dates', () => {
      expect(parseDate('TODAY').success).toBe(true);
      expect(parseDate('YESTERDAY').success).toBe(true);
      expect(parseDate('Today').success).toBe(true);
    });
  });

  describe('Day and month format', () => {
    it('should parse "15 Nov" to November 15 of current year', () => {
      const result = parseDate('15 Nov');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.date.getDate()).toBe(15);
        expect(result.date.getMonth()).toBe(10); // November = month 10
        expect(result.date.getFullYear()).toBe(2024);
      }
    });

    it('should parse full month names "15 November"', () => {
      const result = parseDate('15 November');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.date.getDate()).toBe(15);
        expect(result.date.getMonth()).toBe(10);
      }
    });

    it('should parse different month abbreviations', () => {
      // Mock date is Nov 20, 2024, so use recent dates within 90 days
      const testCases = [
        { input: '15 Nov', month: 10 },
        { input: '10 Nov', month: 10 },
        { input: '1 Oct', month: 9 },
        { input: '25 Sep', month: 8 },
      ];

      testCases.forEach(({ input, month }) => {
        const result = parseDate(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.date.getMonth()).toBe(month);
        }
      });
    });
  });

  describe('Slash format (DD/MM/YYYY)', () => {
    it('should parse UK format "15/11/2024"', () => {
      const result = parseDate('15/11/2024');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.date.getDate()).toBe(15);
        expect(result.date.getMonth()).toBe(10);
        expect(result.date.getFullYear()).toBe(2024);
      }
    });

    it('should reject invalid dates like "32/11/2024"', () => {
      const result = parseDate('32/11/2024');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid date');
      }
    });
  });

  describe('ISO format (YYYY-MM-DD)', () => {
    it('should parse ISO format "2024-11-15"', () => {
      const result = parseDate('2024-11-15');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.date.getDate()).toBe(15);
        expect(result.date.getMonth()).toBe(10);
        expect(result.date.getFullYear()).toBe(2024);
      }
    });

    it('should reject invalid ISO dates', () => {
      const result = parseDate('2024-13-01'); // Invalid month
      expect(result.success).toBe(false);
    });
  });

  describe('Future dates', () => {
    it('should reject future dates (>today)', () => {
      const result = parseDate('tomorrow');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('future');
      }
    });

    it('should reject dates in the future', () => {
      const result = parseDate('2024-11-21'); // Tomorrow
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('future');
      }
    });
  });

  describe('Old dates (>90 days)', () => {
    it('should reject dates older than 90 days', () => {
      const result = parseDate('2024-08-01'); // >90 days ago
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('too old');
      }
    });

    it('should accept dates within 90 days', () => {
      const result = parseDate('2024-11-01'); // 19 days ago
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid input', () => {
    it('should reject empty input', () => {
      const result = parseDate('');
      expect(result.success).toBe(false);
    });

    it('should reject gibberish', () => {
      const result = parseDate('asdfasdf');
      expect(result.success).toBe(false);
    });

    it('should provide helpful error message', () => {
      const result = parseDate('invalid');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
        expect(result.error.length).toBeGreaterThan(0);
      }
    });
  });
});
