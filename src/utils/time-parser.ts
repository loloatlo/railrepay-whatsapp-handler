/**
 * Time Parser Utility
 *
 * SPEC: Day 5 § 4. Date/Time Parsing Utilities
 * Per ADR-014: Implementation written AFTER tests
 *
 * SUPPORTED FORMATS:
 * - 24-hour: "14:30", "09:15"
 * - 12-hour with AM/PM: "2:30pm", "2:30PM", "2:30am"
 * - Compact 24-hour: "1430", "0915"
 * - Hour-only with AM/PM: "2pm", "9am"
 *
 * RETURNS:
 * - { hour: number, minute: number } for valid times
 * - null for invalid times
 */

export interface TimeParseSuccess {
  success: true;
  hour: number;
  minute: number;
}

export interface TimeParseFailure {
  success: false;
  error: string;
}

export type TimeParseResult = TimeParseSuccess | TimeParseFailure;

/**
 * Parse a time string from user input
 *
 * @param input - User's time input
 * @returns ParseResult with hour/minute or error
 */
export function parseTime(input: string): TimeParseResult {
  const trimmed = input.trim().toLowerCase();

  if (!trimmed) {
    return {
      success: false,
      error: 'Please enter a time (e.g., "14:30", "2:30pm", "2pm")',
    };
  }

  // Try 24-hour format with colon (HH:MM)
  const result24Hour = tryParse24Hour(trimmed);
  if (result24Hour !== null) {
    return validateTime(result24Hour.hour, result24Hour.minute);
  }

  // Try 12-hour format with AM/PM
  const result12Hour = tryParse12Hour(trimmed);
  if (result12Hour !== null) {
    return validateTime(result12Hour.hour, result12Hour.minute);
  }

  // Try compact 24-hour format (HHMM)
  const resultCompact = tryParseCompact(trimmed);
  if (resultCompact !== null) {
    return validateTime(resultCompact.hour, resultCompact.minute);
  }

  // Try hour-only with AM/PM
  const resultHourOnly = tryParseHourOnly(trimmed);
  if (resultHourOnly !== null) {
    return validateTime(resultHourOnly.hour, resultHourOnly.minute);
  }

  // Nothing matched
  return {
    success: false,
    error: 'Invalid time format. Try "14:30", "2:30pm", "1430", or "2pm"',
  };
}

function tryParse24Hour(input: string): { hour: number; minute: number } | null {
  // Match HH:MM or H:MM
  const match = input.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);

  return { hour, minute };
}

function tryParse12Hour(input: string): { hour: number; minute: number } | null {
  // Match H:MM(am|pm) or HH:MM(am|pm)
  const match = input.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (!match) {
    return null;
  }

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const meridiem = match[3];

  // Convert to 24-hour format
  if (meridiem === 'pm' && hour !== 12) {
    hour += 12;
  } else if (meridiem === 'am' && hour === 12) {
    hour = 0;
  }

  return { hour, minute };
}

function tryParseCompact(input: string): { hour: number; minute: number } | null {
  // Match HHMM (exactly 4 digits)
  const match = input.match(/^(\d{4})$/);
  if (!match) {
    return null;
  }

  const timeStr = match[1];
  const hour = parseInt(timeStr.slice(0, 2), 10);
  const minute = parseInt(timeStr.slice(2, 4), 10);

  return { hour, minute };
}

function tryParseHourOnly(input: string): { hour: number; minute: number } | null {
  // Match H(am|pm) or HH(am|pm)
  const match = input.match(/^(\d{1,2})\s*(am|pm)$/);
  if (!match) {
    return null;
  }

  let hour = parseInt(match[1], 10);
  const meridiem = match[2];

  // Convert to 24-hour format
  if (meridiem === 'pm' && hour !== 12) {
    hour += 12;
  } else if (meridiem === 'am' && hour === 12) {
    hour = 0;
  }

  return { hour, minute: 0 };
}

function validateTime(hour: number, minute: number): TimeParseResult {
  // Validate hour range
  if (hour < 0 || hour > 23) {
    return {
      success: false,
      error: 'Invalid time: hour must be between 0 and 23',
    };
  }

  // Validate minute range
  if (minute < 0 || minute > 59) {
    return {
      success: false,
      error: 'Invalid time: minute must be between 0 and 59',
    };
  }

  return {
    success: true,
    hour,
    minute,
  };
}
