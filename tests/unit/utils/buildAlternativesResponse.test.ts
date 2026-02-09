/**
 * TD-WHATSAPP-056: buildAlternativesResponse() Utility Tests
 *
 * TECHNICAL DEBT CONTEXT:
 * buildAlternativesResponse() currently lives in routing-alternative.handler.ts (line 272)
 * but needs to be importable by journey-confirm.handler for AC-2 (multi-route NO path)
 *
 * REQUIRED FIX:
 * - AC-5: Extract buildAlternativesResponse() to shared utility
 * - Must be importable by both journey-confirm.handler and routing-alternative.handler
 * - No breaking changes to existing behavior
 *
 * Per ADR-014: Tests written FIRST, implementation follows
 * Per Test Lock Rule: Blake MUST NOT modify these tests
 */

import { describe, it, expect } from 'vitest';

// AC-5: Import from shared utility location (implementation creates this)
import { buildAlternativesResponse } from '../../../src/utils/buildAlternativesResponse';

describe('TD-WHATSAPP-056: buildAlternativesResponse() Utility', () => {
  describe('AC-5: buildAlternativesResponse() importable from shared location', () => {
    it('should be importable from src/utils/buildAlternativesResponse (was: buried in routing-alternative.handler)', () => {
      // AC-5: Verify utility is extracted and importable
      expect(buildAlternativesResponse).toBeDefined();
      expect(typeof buildAlternativesResponse).toBe('function');
    });

    it('should format single direct route correctly', () => {
      // AC-5: Verify output format matches existing implementation

      const routes = [
        {
          legs: [
            { from: 'Abergavenny', to: 'Hereford', departure: '09:31', arrival: '10:00', operator: 'TfW' },
          ],
          totalDuration: '29m',
        },
      ];

      const result = buildAlternativesResponse(routes);

      // Assert: Contains option numbering
      expect(result).toContain('1.');

      // Assert: Contains station names
      expect(result).toContain('Abergavenny');
      expect(result).toContain('Hereford');

      // Assert: Contains departure time
      expect(result).toContain('09:31');

      // Assert: Contains total duration
      expect(result).toContain('29m');

      // Assert: Contains call to action
      expect(result).toContain('Reply');
      expect(result).toContain('NONE');
    });

    it('should format multiple direct routes correctly', () => {
      // AC-5: Verify multi-route formatting

      const routes = [
        {
          legs: [{ from: 'AGV', to: 'HFD', departure: '09:31', arrival: '10:00', operator: 'TfW' }],
          totalDuration: '29m',
        },
        {
          legs: [{ from: 'AGV', to: 'HFD', departure: '10:31', arrival: '11:00', operator: 'TfW' }],
          totalDuration: '29m',
        },
        {
          legs: [{ from: 'AGV', to: 'HFD', departure: '11:31', arrival: '12:00', operator: 'TfW' }],
          totalDuration: '29m',
        },
      ];

      const result = buildAlternativesResponse(routes);

      // Assert: All options numbered
      expect(result).toContain('1.');
      expect(result).toContain('2.');
      expect(result).toContain('3.');

      // Assert: All departure times shown
      expect(result).toContain('09:31');
      expect(result).toContain('10:31');
      expect(result).toContain('11:31');
    });

    it('should format interchange route with multiple legs', () => {
      // AC-5: Verify interchange route formatting (multi-leg journey)

      const routes = [
        {
          legs: [
            { from: 'Abergavenny', to: 'Hereford', departure: '08:31', arrival: '09:00', operator: 'TfW' },
            { from: 'Hereford', to: 'Birmingham New Street', departure: '09:40', arrival: '10:30', operator: 'TfW' },
          ],
          totalDuration: '1h 59m',
        },
      ];

      const result = buildAlternativesResponse(routes);

      // Assert: Station path with arrows
      expect(result).toContain('Abergavenny');
      expect(result).toContain('Hereford');
      expect(result).toContain('Birmingham New Street');
      expect(result).toContain('→'); // Arrow separator

      // Assert: Leg details
      expect(result).toContain('Leg 1');
      expect(result).toContain('Leg 2');

      // Assert: Departure/arrival times for both legs
      expect(result).toContain('08:31');
      expect(result).toContain('09:00');
      expect(result).toContain('09:40');
      expect(result).toContain('10:30');

      // Assert: Total duration
      expect(result).toContain('1h 59m');
    });

    it('should handle empty routes array gracefully', () => {
      // AC-5: Edge case — no routes to format

      const routes: any[] = [];

      const result = buildAlternativesResponse(routes);

      // Assert: Returns valid string (no crash)
      expect(typeof result).toBe('string');

      // Assert: Still contains call to action
      expect(result).toContain('NONE');
    });

    it('should handle route with missing legs gracefully', () => {
      // AC-5: Edge case — malformed route data

      const routes = [
        {
          legs: undefined, // Missing legs
          totalDuration: '0m',
        },
      ];

      const result = buildAlternativesResponse(routes);

      // Assert: Returns valid string (no crash)
      expect(typeof result).toBe('string');
      expect(result).toContain('1.');
    });

    it('should match existing routing-alternative.handler output format', () => {
      // AC-5: Ensure backward compatibility with existing implementation
      // REQUIREMENT: Extracted utility must produce IDENTICAL output

      const routes = [
        {
          legs: [
            { from: 'Paddington', to: 'Reading', departure: '08:00', arrival: '08:30', operator: 'GWR' },
            { from: 'Reading', to: 'Cardiff Central', departure: '09:00', arrival: '10:30', operator: 'GWR' },
          ],
          totalDuration: '2h 30m',
        },
      ];

      const result = buildAlternativesResponse(routes);

      // Assert: Contains header text
      expect(result).toContain('alternative routes');

      // Assert: Contains option numbering before station path
      expect(result).toMatch(/1\.\s+Paddington/);

      // Assert: Contains indented leg details (3 spaces)
      expect(result).toMatch(/\s{3}Leg 1:/);
      expect(result).toMatch(/\s{3}Leg 2:/);

      // Assert: Contains total duration with "Total:" prefix
      expect(result).toContain('Total: 2h 30m');

      // Assert: Contains footer instructions
      expect(result).toContain('Reply with 1, 2, or 3');
      expect(result).toContain('NONE if none of these match');
    });

    it('should format operator names in leg details', () => {
      // AC-5: Verify operator names are included

      const routes = [
        {
          legs: [
            { from: 'AGV', to: 'HFD', departure: '09:31', arrival: '10:00', operator: 'Transport for Wales' },
          ],
          totalDuration: '29m',
        },
      ];

      const result = buildAlternativesResponse(routes);

      // Assert: Operator name included
      expect(result).toContain('Transport for Wales');
    });

    it('should use arrow (→) for station path separator', () => {
      // AC-5: Verify exact formatting of station path

      const routes = [
        {
          legs: [
            { from: 'A', to: 'B', departure: '08:00', arrival: '08:30', operator: 'X' },
            { from: 'B', to: 'C', departure: '09:00', arrival: '09:30', operator: 'Y' },
          ],
          totalDuration: '1h 30m',
        },
      ];

      const result = buildAlternativesResponse(routes);

      // Assert: Station path uses arrow separator
      expect(result).toContain('A → B → C');
    });
  });
});
