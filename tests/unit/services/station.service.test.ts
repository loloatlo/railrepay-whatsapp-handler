/**
 * Station Service Tests
 *
 * Tests for direct database query implementation
 * See TD-WHATSAPP-045: Create dedicated station-finder service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchStations } from '../../../src/services/station.service.js';

// Mock the database pool
const mockQuery = vi.fn();
vi.mock('../../../src/db/pool.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));

// Mock the logger
vi.mock('../../../src/lib/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Station Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful searches', () => {
    it('should return stations matching query by name', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ crs: 'AGV', name: 'Abergavenny' }],
      });

      const results = await searchStations('Abergavenny');

      expect(results).toEqual([{ crs: 'AGV', name: 'Abergavenny' }]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('timetable_loader.stations'),
        expect.arrayContaining(['%Abergavenny%', 'Abergavenny'])
      );
    });

    it('should return station by CRS code', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ crs: 'AGV', name: 'Abergavenny' }],
      });

      const results = await searchStations('AGV');

      expect(results).toHaveLength(1);
      expect(results[0].crs).toBe('AGV');
    });

    it('should handle multiple matches', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { crs: 'MAN', name: 'Manchester Piccadilly' },
          { crs: 'MCV', name: 'Manchester Victoria' },
          { crs: 'MCO', name: 'Manchester Oxford Road' },
        ],
      });

      const results = await searchStations('Manchester');

      expect(results).toHaveLength(3);
    });

    it('should return empty array for no matches', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const results = await searchStations('NonExistent');

      expect(results).toEqual([]);
    });
  });

  describe('Input validation', () => {
    it('should return empty array for short query (less than 2 chars)', async () => {
      const results = await searchStations('A');

      expect(results).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return empty array for empty query', async () => {
      const results = await searchStations('');

      expect(results).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should return empty array on database error', async () => {
      mockQuery.mockRejectedValue(new Error('DB connection failed'));

      const results = await searchStations('Test');

      expect(results).toEqual([]);
    });

    it('should return empty array on query timeout', async () => {
      mockQuery.mockRejectedValue(new Error('Query timeout'));

      const results = await searchStations('Kings Cross');

      expect(results).toEqual([]);
    });
  });

  describe('Query structure', () => {
    it('should query timetable_loader.stations table', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await searchStations('London');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('timetable_loader.stations'),
        expect.any(Array)
      );
    });

    it('should search by name using LIKE with wildcard', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await searchStations('Padding');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIKE'),
        expect.arrayContaining(['%Padding%'])
      );
    });

    it('should also match by CRS code', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await searchStations('PAD');

      // Query should include both name search and CRS search
      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[0]).toContain('crs_code');
      expect(callArgs[1]).toEqual(expect.arrayContaining(['PAD']));
    });

    it('should limit results to 10', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await searchStations('Station');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 10'),
        expect.any(Array)
      );
    });
  });
});
