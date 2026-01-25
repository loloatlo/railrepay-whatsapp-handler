/**
 * Time Parser Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 4. Date/Time Parsing Utilities
 * Per ADR-014: These tests define the time parsing behavior
 */

import { describe, it, expect } from 'vitest';
import { parseTime } from '../../../src/utils/time-parser';

describe('Time Parser', () => {
  describe('24-hour format (HH:MM)', () => {
    it('should parse "14:30" to { hour: 14, minute: 30 }', () => {
      const result = parseTime('14:30');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(14);
        expect(result.minute).toBe(30);
      }
    });

    it('should parse "09:15" with leading zero', () => {
      const result = parseTime('09:15');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(9);
        expect(result.minute).toBe(15);
      }
    });

    it('should parse "23:59" (valid boundary)', () => {
      const result = parseTime('23:59');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(23);
        expect(result.minute).toBe(59);
      }
    });

    it('should parse "00:00" (midnight)', () => {
      const result = parseTime('00:00');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(0);
        expect(result.minute).toBe(0);
      }
    });
  });

  describe('12-hour format with AM/PM', () => {
    it('should parse "2:30pm" to { hour: 14, minute: 30 }', () => {
      const result = parseTime('2:30pm');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(14);
        expect(result.minute).toBe(30);
      }
    });

    it('should parse "2:30PM" (uppercase) to { hour: 14, minute: 30 }', () => {
      const result = parseTime('2:30PM');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(14);
        expect(result.minute).toBe(30);
      }
    });

    it('should parse "2:30am" to { hour: 2, minute: 30 }', () => {
      const result = parseTime('2:30am');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(2);
        expect(result.minute).toBe(30);
      }
    });

    it('should parse "12:00pm" (noon) to { hour: 12, minute: 0 }', () => {
      const result = parseTime('12:00pm');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(12);
        expect(result.minute).toBe(0);
      }
    });

    it('should parse "12:00am" (midnight) to { hour: 0, minute: 0 }', () => {
      const result = parseTime('12:00am');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(0);
        expect(result.minute).toBe(0);
      }
    });

    it('should parse "11:59pm" to { hour: 23, minute: 59 }', () => {
      const result = parseTime('11:59pm');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(23);
        expect(result.minute).toBe(59);
      }
    });
  });

  describe('Compact 24-hour format (HHMM)', () => {
    it('should parse "1430" to { hour: 14, minute: 30 }', () => {
      const result = parseTime('1430');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(14);
        expect(result.minute).toBe(30);
      }
    });

    it('should parse "0915" to { hour: 9, minute: 15 }', () => {
      const result = parseTime('0915');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(9);
        expect(result.minute).toBe(15);
      }
    });

    it('should parse "2359" to { hour: 23, minute: 59 }', () => {
      const result = parseTime('2359');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(23);
        expect(result.minute).toBe(59);
      }
    });
  });

  describe('Hour-only format with AM/PM', () => {
    it('should parse "2pm" to { hour: 14, minute: 0 }', () => {
      const result = parseTime('2pm');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(14);
        expect(result.minute).toBe(0);
      }
    });

    it('should parse "9am" to { hour: 9, minute: 0 }', () => {
      const result = parseTime('9am');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(9);
        expect(result.minute).toBe(0);
      }
    });

    it('should parse "12PM" (noon) to { hour: 12, minute: 0 }', () => {
      const result = parseTime('12PM');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hour).toBe(12);
        expect(result.minute).toBe(0);
      }
    });
  });

  describe('Invalid times', () => {
    it('should reject "25:00" (hour > 23)', () => {
      const result = parseTime('25:00');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid');
      }
    });

    it('should reject "14:60" (minute > 59)', () => {
      const result = parseTime('14:60');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid');
      }
    });

    it('should reject "13pm" (invalid 12-hour format)', () => {
      const result = parseTime('13pm');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid');
      }
    });

    it('should reject empty input', () => {
      const result = parseTime('');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
      }
    });

    it('should reject gibberish input', () => {
      const result = parseTime('asdf');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
      }
    });

    it('should provide helpful error message', () => {
      const result = parseTime('invalid');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('time');
        expect(result.error.length).toBeGreaterThan(10);
      }
    });
  });
});
