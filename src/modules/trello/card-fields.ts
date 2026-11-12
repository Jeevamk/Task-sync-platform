/**
 * Helpers for card fields shared by every way a card is created (sheet import, API).
 */

/** Same name ignoring case and outer spaces. */
export const norm = (v: string) => v.trim().toLowerCase();

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Due date for Trello as an ISO timestamp, or null if the value is not a valid date.
 *   "2026-11-20"                -> due at 18:00 India time that day (the team's end of day)
 *   "2026-11-20T10:00:00Z" etc. -> that exact time (a time zone is required)
 */
export function toTrelloDue(value: string): string | null {
  const v = value.trim();
  const iso = DATE_ONLY.test(v) ? `${v}T18:00:00+05:30` : DATE_TIME.test(v) ? v : null;
  if (!iso) return null;
  // JavaScript quietly turns 2026-02-31 into 3 March: refuse days that don't exist.
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== d || m < 1 || m > 12) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
