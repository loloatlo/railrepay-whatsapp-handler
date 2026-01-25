/**
 * TOC Names Tests - Written FIRST per ADR-014 (TDD)
 *
 * Tests for mapping UK Train Operating Company codes to full names
 */

import { describe, it, expect } from 'vitest';
import { getTocName } from '../../../src/utils/toc-names';

describe('TOC Names', () => {
  describe('OTP format with colon prefix ("1:AW")', () => {
    it('should return full name for "1:AW"', () => {
      expect(getTocName('1:AW')).toBe('Transport for Wales');
    });

    it('should return full name for "1:GW"', () => {
      expect(getTocName('1:GW')).toBe('Great Western Railway');
    });

    it('should return full name for "1:GR"', () => {
      expect(getTocName('1:GR')).toBe('LNER');
    });
  });

  describe('Plain TOC codes', () => {
    it('should return full name for "GW"', () => {
      expect(getTocName('GW')).toBe('Great Western Railway');
    });

    it('should return full name for "AW"', () => {
      expect(getTocName('AW')).toBe('Transport for Wales');
    });

    it('should return full name for "VT"', () => {
      expect(getTocName('VT')).toBe('Avanti West Coast');
    });

    it('should return full name for "XC"', () => {
      expect(getTocName('XC')).toBe('CrossCountry');
    });

    it('should return full name for "SE"', () => {
      expect(getTocName('SE')).toBe('Southeastern');
    });

    it('should return full name for "SW"', () => {
      expect(getTocName('SW')).toBe('South Western Railway');
    });
  });

  describe('Hyphen format ("1-AW")', () => {
    it('should handle hyphen format "1-AW"', () => {
      expect(getTocName('1-AW')).toBe('Transport for Wales');
    });

    it('should handle hyphen format "2-GW"', () => {
      expect(getTocName('2-GW')).toBe('Great Western Railway');
    });
  });

  describe('Case insensitivity', () => {
    it('should be case-insensitive for lowercase "aw"', () => {
      expect(getTocName('aw')).toBe('Transport for Wales');
    });

    it('should be case-insensitive for lowercase "gw"', () => {
      expect(getTocName('gw')).toBe('Great Western Railway');
    });

    it('should be case-insensitive for mixed case "1:aw"', () => {
      expect(getTocName('1:aw')).toBe('Transport for Wales');
    });
  });

  describe('Unknown codes', () => {
    it('should return original code if unknown', () => {
      expect(getTocName('XX')).toBe('XX');
    });

    it('should return original code with prefix if unknown', () => {
      expect(getTocName('1:ZZ')).toBe('ZZ');
    });

    it('should handle empty string gracefully', () => {
      expect(getTocName('')).toBe('');
    });
  });

  describe('All DR15 scheme operators', () => {
    it('should map c2c', () => {
      expect(getTocName('CC')).toBe('c2c');
    });

    it('should map Thameslink', () => {
      expect(getTocName('TL')).toBe('Thameslink');
    });

    it('should map Great Northern', () => {
      expect(getTocName('GN')).toBe('Great Northern');
    });

    it('should map Southern', () => {
      expect(getTocName('SN')).toBe('Southern');
    });

    it('should map Gatwick Express', () => {
      expect(getTocName('GX')).toBe('Gatwick Express');
    });
  });

  describe('All DR30 scheme operators', () => {
    it('should map Chiltern Railways', () => {
      expect(getTocName('CH')).toBe('Chiltern Railways');
    });

    it('should map Caledonian Sleeper', () => {
      expect(getTocName('CS')).toBe('Caledonian Sleeper');
    });

    it('should map East Midlands Railway', () => {
      expect(getTocName('EM')).toBe('East Midlands Railway');
    });

    it('should map Grand Central', () => {
      expect(getTocName('GC')).toBe('Grand Central');
    });

    it('should map Hull Trains', () => {
      expect(getTocName('HT')).toBe('Hull Trains');
    });

    it('should map Heathrow Express', () => {
      expect(getTocName('HX')).toBe('Heathrow Express');
    });

    it('should map West Midlands Trains', () => {
      expect(getTocName('LM')).toBe('West Midlands Trains');
    });

    it('should map Northern', () => {
      expect(getTocName('NT')).toBe('Northern');
    });

    it('should map ScotRail', () => {
      expect(getTocName('SR')).toBe('ScotRail');
    });

    it('should map TransPennine Express', () => {
      expect(getTocName('TP')).toBe('TransPennine Express');
    });

    it('should map Elizabeth line', () => {
      expect(getTocName('XR')).toBe('Elizabeth line');
    });
  });
});
