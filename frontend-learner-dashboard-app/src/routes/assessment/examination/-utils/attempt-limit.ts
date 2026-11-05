/** Limit the admin app writes for MOCK and PRACTICE tests, meaning "no limit". */
export const UNLIMITED_ATTEMPTS = 100000;

export type AttemptSummary =
  | { kind: "unlimited" }
  | { kind: "unused"; max: number }
  | { kind: "used"; used: number; max: number };

/** What a test card should say about attempts; null when there is nothing to say. */
export function summarizeAttempts(
  used: number,
  max: number
): AttemptSummary | null {
  if (max >= UNLIMITED_ATTEMPTS) return { kind: "unlimited" };
  if (max <= 0) return null;
  return used > 0 ? { kind: "used", used, max } : { kind: "unused", max };
}
