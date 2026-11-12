/**
 * Helpers that keep personal data and secrets out of logs.
 * Rule for the whole codebase: never log tokens, secrets, request bodies or full emails.
 */

/** "athirashivaram@gmail.com" -> "at***@gmail.com" */
export function maskEmail(email: string | null | undefined): string {
  const s = String(email ?? '').trim();
  const at = s.indexOf('@');
  if (at < 1) return s ? '***' : '';
  return `${s.slice(0, Math.min(2, at))}***${s.slice(at)}`;
}

/** Long IDs shortened for readability: "41e71bcd-ff87-4728-…" -> "41e71bcd" */
export function shortId(id: string | null | undefined): string {
  return String(id ?? '').slice(0, 8);
}

/** Error message for logs, cut to a sane length. */
export function errMsg(err: unknown, max = 300): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > max ? `${m.slice(0, max)}…` : m;
}
