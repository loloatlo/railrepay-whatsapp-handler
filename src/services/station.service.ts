/**
 * Station Service - Search for railway stations
 *
 * SPEC: Day 5 § 3. Station Service
 * Per ADR-014: Implementation written AFTER tests
 *
 * Calls timetable-loader service to search for stations
 */

import { getLogger } from '../lib/logger.js';

const logger = getLogger();

export interface Station {
  crs: string; // 3-letter station code (e.g., "KGX" for Kings Cross)
  name: string; // Full station name
}

const TIMETABLE_LOADER_URL = process.env.TIMETABLE_LOADER_URL || 'http://localhost:3001';

/**
 * Search for stations by name
 *
 * @param query - Search query (station name or partial name)
 * @returns Array of matching stations (empty if none found or error)
 */
export async function searchStations(query: string): Promise<Station[]> {
  try {
    const url = `${TIMETABLE_LOADER_URL}/api/v1/stations/search?q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error('Station search failed', {
        component: 'whatsapp-handler/station-service',
        status: response.status,
        url,
      });
      return [];
    }

    const data = await response.json() as Station[];
    return data;
  } catch (error) {
    logger.error('Station search error', {
      component: 'whatsapp-handler/station-service',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}
