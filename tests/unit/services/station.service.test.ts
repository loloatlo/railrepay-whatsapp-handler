/**
 * Station Service Tests - Written FIRST per ADR-014 (TDD)
 *
 * SPEC: Day 5 § 3. Station Service
 * Per ADR-014: These tests define the behavior
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchStations } from '../../../src/services/station.service';

// Mock fetch globally
global.fetch = vi.fn();

describe('Station Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Successful searches', () => {
    it('should return stations for valid query', async () => {
      // Arrange
      const mockResponse = [
        { crs: 'KGX', name: 'London Kings Cross' },
        { crs: 'EDB', name: 'Edinburgh' },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // Act
      const result = await searchStations('Kings Cross');

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].crs).toBe('KGX');
      expect(result[0].name).toBe('London Kings Cross');
    });

    it('should return empty array when no matches', async () => {
      // Arrange
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Act
      const result = await searchStations('NonexistentStation');

      // Assert
      expect(result).toEqual([]);
    });

    it('should call timetable-loader API with correct URL', async () => {
      // Arrange
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Act
      await searchStations('Manchester');

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/stations/search?q=Manchester'),
        expect.any(Object)
      );
    });

    it('should handle single match', async () => {
      // Arrange
      const mockResponse = [{ crs: 'MAN', name: 'Manchester Piccadilly' }];
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // Act
      const result = await searchStations('Manchester');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].crs).toBe('MAN');
    });

    it('should handle multiple matches', async () => {
      // Arrange
      const mockResponse = [
        { crs: 'MAN', name: 'Manchester Piccadilly' },
        { crs: 'MCV', name: 'Manchester Victoria' },
        { crs: 'MCO', name: 'Manchester Oxford Road' },
      ];
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // Act
      const result = await searchStations('Manchester');

      // Assert
      expect(result).toHaveLength(3);
    });
  });

  describe('Error handling', () => {
    it('should return empty array on API error', async () => {
      // Arrange
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Act
      const result = await searchStations('Kings Cross');

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array on network error', async () => {
      // Arrange
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      // Act
      const result = await searchStations('Kings Cross');

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array on invalid JSON', async () => {
      // Arrange
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      // Act
      const result = await searchStations('Kings Cross');

      // Assert
      expect(result).toEqual([]);
    });
  });
});
