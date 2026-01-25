/**
 * UK Train Operating Company (TOC) name mappings
 *
 * Source: eligibility_engine.toc_rulepacks table
 * Last updated: 2026-01-25
 *
 * Per ADR-014: Implementation written AFTER tests
 */

const TOC_NAMES: Record<string, string> = {
  // DR15 Scheme (Enhanced)
  'CC': 'c2c',
  'TL': 'Thameslink',
  'GN': 'Great Northern',
  'SE': 'Southeastern',
  'SN': 'Southern',
  'SW': 'South Western Railway',
  'GX': 'Gatwick Express',
  'GR': 'LNER',

  // DR30 Scheme (Standard)
  'AW': 'Transport for Wales',
  'CH': 'Chiltern Railways',
  'CS': 'Caledonian Sleeper',
  'EM': 'East Midlands Railway',
  'GC': 'Grand Central',
  'GW': 'Great Western Railway',
  'HT': 'Hull Trains',
  'HX': 'Heathrow Express',
  'LM': 'West Midlands Trains',
  'NT': 'Northern',
  'SR': 'ScotRail',
  'TP': 'TransPennine Express',
  'VT': 'Avanti West Coast',
  'XC': 'CrossCountry',
  'XR': 'Elizabeth line',
};

/**
 * Parse OTP operator code and return full TOC name
 *
 * @param operatorCode - Raw operator from OTP (e.g., "1:AW", "AW", "1-AW")
 * @returns Full TOC name or original code if not found
 *
 * @example
 * getTocName("1:AW") -> "Transport for Wales"
 * getTocName("GW") -> "Great Western Railway"
 * getTocName("Unknown") -> "Unknown"
 */
export function getTocName(operatorCode: string): string {
  if (!operatorCode) {
    return operatorCode;
  }

  // Extract TOC code from various formats
  // "1:AW" -> "AW", "1-AW" -> "AW", "AW" -> "AW"
  const code = operatorCode
    .split(/[:\-]/)
    .pop()
    ?.toUpperCase() || operatorCode;

  return TOC_NAMES[code] || code;
}
