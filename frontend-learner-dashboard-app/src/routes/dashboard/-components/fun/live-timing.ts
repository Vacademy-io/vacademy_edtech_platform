import { convertSessionTimeToUserTimezone } from "@/utils/timezone";
import type { SessionDetails } from "@/routes/study-library/live-class/-types/types";

/**
 * When a class shows on the Fun home, and how. The windows are the ones the
 * default hero and the upcoming-classes widget already use:
 *
 * - live: now is between the class's start and its last entry time (a last
 *   entry earlier than the start rolls past midnight; none at all = one hour);
 * - soon: it starts within the next 60 minutes;
 * - later: it starts within the next 24 hours.
 *
 * Pure, with `now` passed in, so the rules can be tested without a clock.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** A class starting within this window gets the card above the hero. */
export const SOON_WINDOW_MS = 60 * MINUTE_MS;
/** A class starting within this window gets the Today card. */
export const LATER_WINDOW_MS = DAY_MS;

function sessionDate(meetingDate: string, time: string, timezone?: string): Date {
  if (timezone) return convertSessionTimeToUserTimezone(meetingDate, time, timezone);
  return new Date(`${meetingDate}T${time}`);
}

export function sessionStartMs(session: SessionDetails): number {
  try {
    return sessionDate(session.meeting_date, session.start_time, session.timezone).getTime();
  } catch {
    return Number.NaN;
  }
}

/** The last moment a learner can join; one hour after the start when it cannot be read. */
export function sessionEndMs(session: SessionDetails): number {
  const startMs = sessionStartMs(session);
  let endMs: number;
  try {
    endMs = sessionDate(session.meeting_date, session.last_entry_time, session.timezone).getTime();
  } catch {
    endMs = Number.NaN;
  }
  if (Number.isNaN(endMs)) endMs = startMs + HOUR_MS;
  if (endMs < startMs) endMs += DAY_MS;
  return endMs;
}

export interface BannerClass {
  session: SessionDetails;
  isLive: boolean;
  /** Whole minutes until the start, at least 1; 0 while live. */
  minutesUntilStart: number;
}

/** Any live class wins; else the soonest one starting within the hour. */
export function bannerClassOf(sessions: readonly SessionDetails[] | undefined, nowMs: number): BannerClass | null {
  if (!sessions || sessions.length === 0) return null;
  let soon: BannerClass | null = null;
  let soonStart = Number.POSITIVE_INFINITY;
  for (const session of sessions) {
    const startMs = sessionStartMs(session);
    if (Number.isNaN(startMs)) continue;
    const endMs = sessionEndMs(session);
    if (nowMs >= startMs && nowMs <= endMs) return { session, isLive: true, minutesUntilStart: 0 };
    if (startMs > nowMs && startMs - nowMs <= SOON_WINDOW_MS && startMs < soonStart) {
      soonStart = startMs;
      soon = { session, isLive: false, minutesUntilStart: Math.max(1, Math.ceil((startMs - nowMs) / MINUTE_MS)) };
    }
  }
  return soon;
}

const sameClass = (a: SessionDetails, b: SessionDetails) =>
  a.schedule_id === b.schedule_id && a.session_id === b.session_id;

/**
 * The next class within 24 hours that is not already on the card above the hero:
 * the one the Today card shows, with a calendar chip and never the word "live".
 */
export function laterClassOf(
  sessions: readonly SessionDetails[] | undefined,
  nowMs: number,
  banner: BannerClass | null,
): SessionDetails | null {
  let best: SessionDetails | null = null;
  let bestStart = Number.POSITIVE_INFINITY;
  for (const session of sessions ?? []) {
    if (banner && sameClass(session, banner.session)) continue;
    const startMs = sessionStartMs(session);
    if (Number.isNaN(startMs) || startMs <= nowMs) continue;
    if (startMs - nowMs > LATER_WINDOW_MS) continue;
    if (startMs < bestStart) {
      bestStart = startMs;
      best = session;
    }
  }
  return best;
}

/** 0 when the class starts today on the device's calendar, 1 tomorrow, and so on. */
export function dayOffset(startMs: number, nowMs: number): number {
  const start = new Date(startMs);
  const now = new Date(nowMs);
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / DAY_MS);
}
