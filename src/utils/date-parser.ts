/**
 * Date Parser Utility
 *
 * SPEC: Day 5 § 4. Date/Time Parsing Utilities
 * Per ADR-014: Implementation written AFTER tests
 *
 * SUPPORTED FORMATS:
 * - Relative: "today", "yesterday"
 * - Day/Month: "15 Nov", "15 November"
 * - UK slash: "15/11/2024"
 * - ISO: "2024-11-15"
 *
 * VALIDATION:
 * - Rejects future dates (>today)
 * - Rejects dates >90 days old (rail claims limit)
 */

export interface DateParseSuccess {
  success: true;
  date: Date;
}

export interface DateParseFailure {
  success: false;
  error: string;
}

export type DateParseResult = DateParseSuccess | DateParseFailure;

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const MONTH_ABBREV = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const MAX_CLAIM_AGE_DAYS = 90;

/**
 * Parse a date string from user input
 *
 * @param input - User's date input
 * @returns ParseResult with date or error
 */
export function parseDate(input: string): DateParseResult {
  const trimmed = input.trim().toLowerCase();

  if (!trimmed) {
    return {
      success: false,
      error: 'Please enter a date (e.g., "today", "yesterday", "15 Nov", "15/11/2024")',
    };
  }

  // Try relative dates
  const relativeResult = tryParseRelative(trimmed);
  if (relativeResult) {
    return validateDateConstraints(relativeResult);
  }

  // Try day/month format
  const dayMonthResult = tryParseDayMonth(trimmed);
  if (dayMonthResult) {
    return validateDateConstraints(dayMonthResult);
  }

  // Try UK slash format (DD/MM/YYYY)
  const slashResult = tryParseSlash(trimmed);
  if (slashResult) {
    return validateDateConstraints(slashResult);
  }

  // Try ISO format (YYYY-MM-DD)
  const isoResult = tryParseISO(trimmed);
  if (isoResult) {
    return validateDateConstraints(isoResult);
  }

  // Nothing matched
  return {
    success: false,
    error: 'Invalid date format. Try "today", "yesterday", "15 Nov", or "15/11/2024"',
  };
}

function tryParseRelative(input: string): Date | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (input === 'today') {
    return today;
  }

  if (input === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
  }

  if (input === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }

  return null;
}

function tryParseDayMonth(input: string): Date | null {
  // Match formats like "15 Nov" or "15 November"
  const match = input.match(/^(\d{1,2})\s+([a-z]+)$/);
  if (!match) {
    return null;
  }

  const day = parseInt(match[1], 10);
  const monthStr = match[2];

  let monthIndex = -1;

  // Try full month name
  monthIndex = MONTH_NAMES.indexOf(monthStr);

  // Try month abbreviation if full name didn't match
  if (monthIndex === -1) {
    monthIndex = MONTH_ABBREV.indexOf(monthStr);
  }

  if (monthIndex === -1) {
    return null;
  }

  // Assume current year first
  const now = new Date();
  const currentYear = now.getFullYear();
  let date = new Date(currentYear, monthIndex, day, 0, 0, 0, 0);

  // If the date is invalid (e.g., Feb 30), return null
  if (date.getDate() !== day || date.getMonth() !== monthIndex) {
    return null;
  }

  // If the date is in the future, try previous year
  if (date > now) {
    date = new Date(currentYear - 1, monthIndex, day, 0, 0, 0, 0);
    if (date.getDate() !== day || date.getMonth() !== monthIndex) {
      return null;
    }
  }

  return date;
}

function tryParseSlash(input: string): Date | null {
  // Match DD/MM/YYYY
  const match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // Months are 0-indexed
  const year = parseInt(match[3], 10);

  const date = new Date(year, month, day, 0, 0, 0, 0);

  // Validate the date is correct (catches Feb 30, etc.)
  if (date.getDate() === day && date.getMonth() === month && date.getFullYear() === year) {
    return date;
  }

  return null;
}

function tryParseISO(input: string): Date | null {
  // Match YYYY-MM-DD
  const match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // Months are 0-indexed
  const day = parseInt(match[3], 10);

  const date = new Date(year, month, day, 0, 0, 0, 0);

  // Validate
  if (date.getDate() === day && date.getMonth() === month && date.getFullYear() === year) {
    return date;
  }

  return null;
}

function validateDateConstraints(date: Date): DateParseResult {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Reject future dates
  if (date > today) {
    return {
      success: false,
      error: 'Sorry, I can only help with past or today journeys (no future journeys yet).',
    };
  }

  // Check if older than 90 days
  const diffInMs = today.getTime() - date.getTime();
  const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

  if (diffInDays > MAX_CLAIM_AGE_DAYS) {
    return {
      success: false,
      error: `Sorry, that journey is too old to claim (>90 days). Claims must be made within ${MAX_CLAIM_AGE_DAYS} days of travel.`,
    };
  }

  return {
    success: true,
    date,
  };
}
