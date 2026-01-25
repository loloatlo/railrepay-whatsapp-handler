/**
 * Station Service - Search for railway stations
 *
 * TEMPORARY: Direct database query to timetable_loader.stations
 * See TD-WHATSAPP-045: Create dedicated station-finder service
 *
 * This violates service boundaries but unblocks the user flow.
 * The proper solution is a dedicated station-finder service with its own API.
 */

import { getPool } from '../db/pool.js';
import { getLogger } from '../lib/logger.js';

const logger = getLogger();

export interface Station {
  crs: string; // 3-letter station code (e.g., "AGV" for Abergavenny)
  name: string; // Full station name
}

/**
 * Search for stations by name or CRS code
 * Queries timetable_loader.stations table directly
 *
 * @param query - Search query (station name or CRS code)
 * @returns Array of matching stations (empty if none found)
 */
export async function searchStations(query: string): Promise<Station[]> {
  if (!query || query.length < 2) {
    return [];
  }

  try {
    const pool = getPool();

    const result = await pool.query(
      `SELECT crs_code as crs, name
       FROM timetable_loader.stations
       WHERE LOWER(name) LIKE LOWER($1)
          OR UPPER(crs_code) = UPPER($2)
       ORDER BY
         CASE WHEN UPPER(crs_code) = UPPER($2) THEN 0 ELSE 1 END,
         name
       LIMIT 10`,
      [`%${query}%`, query]
    );

    return result.rows;
  } catch (error) {
    logger.error('Station search error', {
      component: 'whatsapp-handler/station-service',
      error: error instanceof Error ? error.message : 'Unknown error',
      query,
    });
    return [];
  }
}
