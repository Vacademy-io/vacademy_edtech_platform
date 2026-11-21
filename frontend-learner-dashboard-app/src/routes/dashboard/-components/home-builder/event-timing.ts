/**
 * Event block timing (spec 7.4.5). Every time is an instant from the server;
 * naive local strings are never parsed.
 *
 *   BEFORE  now < join_opens_at            → Register (or nothing)
 *   JOIN    join_opens_at <= now < starts   → Join
 *   LIVE    starts <= now < ends            → Join, "Live now"
 *   ENDED   now >= ends                     → the block hides itself
 */
export type EventPhase = "BEFORE" | "JOIN" | "LIVE" | "ENDED";

export interface EventTimes {
  startsMs: number;
  endsMs: number;
  joinOpensMs: number;
}

export const DEFAULT_JOIN_OPENS_MINUTES = 15;

export function eventTimes(config: {
  starts_at: string;
  ends_at: string;
  join_opens_at?: string | null;
  join_opens_minutes?: number | null;
}): EventTimes | null {
  const startsMs = Date.parse(config.starts_at);
  const endsMs = Date.parse(config.ends_at);
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) return null;
  const fromServer = config.join_opens_at ? Date.parse(config.join_opens_at) : NaN;
  const minutes = Math.min(120, Math.max(0, config.join_opens_minutes ?? DEFAULT_JOIN_OPENS_MINUTES));
  const joinOpensMs = Number.isFinite(fromServer) ? fromServer : startsMs - minutes * 60_000;
  return { startsMs, endsMs, joinOpensMs };
}

export function eventPhase(times: EventTimes, nowMs: number): EventPhase {
  if (nowMs >= times.endsMs) return "ENDED";
  if (nowMs >= times.startsMs) return "LIVE";
  if (nowMs >= times.joinOpensMs) return "JOIN";
  return "BEFORE";
}

export type Countdown =
  | { kind: "days"; days: number; hours: number }
  | { kind: "hours"; hours: number; minutes: number }
  | { kind: "minutes"; minutes: number }
  | { kind: "seconds"; seconds: number }
  | { kind: "live" }
  | { kind: "ended" };

/** "Starts in 2 d 4 h" → "in 3 h 5 min" → "in 12 min" (final hour) → "in 45 s" → "Live now". */
export function countdown(times: EventTimes, nowMs: number): Countdown {
  if (nowMs >= times.endsMs) return { kind: "ended" };
  const left = times.startsMs - nowMs;
  if (left <= 0) return { kind: "live" };
  const totalSeconds = Math.ceil(left / 1000);
  if (totalSeconds <= 60) return { kind: "seconds", seconds: totalSeconds };
  const totalMinutes = Math.ceil(left / 60_000);
  if (totalMinutes <= 60) return { kind: "minutes", minutes: totalMinutes };
  const totalHours = Math.floor(left / 3_600_000);
  if (totalHours < 24) {
    return { kind: "hours", hours: totalHours, minutes: Math.floor((left % 3_600_000) / 60_000) };
  }
  return { kind: "days", days: Math.floor(totalHours / 24), hours: totalHours % 24 };
}

/**
 * How long until the countdown text next changes: every second in the last
 * minute before the start, otherwise at the next minute boundary (at most 60 s),
 * and exactly at the join, start and end instants so the CTA switches on time.
 */
export function nextTickDelay(times: EventTimes, nowMs: number): number {
  const boundaries = [times.joinOpensMs, times.startsMs, times.endsMs].filter((t) => t > nowMs);
  const toBoundary = boundaries.length ? Math.min(...boundaries) - nowMs : Infinity;
  const left = times.startsMs - nowMs;
  // The text is relative to the start, so it changes when `left` crosses a
  // whole minute (or, in the last minute, a whole second).
  let step: number;
  if (left > 60_000) step = left % 60_000 || 60_000;
  else if (left > 0) step = left % 1000 || 1000;
  else step = 60_000;
  return Math.max(200, Math.min(step, toBoundary));
}
