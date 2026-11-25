/**
 * Pure helpers for the class-first home: which class is next, when its join
 * opens, and how to say the batch's weekly pattern ("Mon & Wed, 8:00 PM")
 * from the schedule itself, never from the batch's code name.
 */
import { getActiveLocale } from "@/lib/formatters";
import { convertSessionTimeToUserTimezone } from "@/utils/timezone";
import type { SessionDetails } from "@/routes/study-library/live-class/-types/types";
import type { LearnerHomeSummary } from "@/services/learner-home-summary";

/** Course and stage of a class, when the live-session API carries them. */
export interface SessionBatchDetails {
  package_session_id?: string;
  package_name?: string | null;
  level_name?: string | null;
  session_name?: string | null;
}

export type SessionWithBatch = SessionDetails & {
  package_session_details?: SessionBatchDetails[] | null;
};

/** Start of a class in the learner's own clock (classes are set in their timezone, usually IST). */
export function sessionStart(session: Pick<SessionDetails, "meeting_date" | "start_time" | "timezone">): Date {
  return session.timezone
    ? convertSessionTimeToUserTimezone(session.meeting_date, session.start_time, session.timezone)
    : new Date(`${session.meeting_date}T${session.start_time}`);
}

/** When the dashboard's join flow starts acting: the start less the waiting-room minutes. */
export function joinOpensAt(session: SessionDetails): Date {
  return new Date(sessionStart(session).getTime() - (session.waiting_room_time || 0) * 60_000);
}

/** Same rule as the dashboard's join flow (sessionJoinOpen in dashboard/index.tsx). */
export function isJoinOpen(session: SessionDetails, nowMs: number): boolean {
  const opens = joinOpensAt(session).getTime();
  return Number.isFinite(opens) && nowMs >= opens;
}

/**
 * The next class: the one the server named (soonest in the learner's own
 * batches), found in the live / upcoming list the join flow works from; else
 * the first live or upcoming class in that list.
 */
export function pickNextClass(
  sessions: SessionDetails[],
  next: LearnerHomeSummary["next_class"]
): SessionWithBatch | null {
  if (next) {
    const match = sessions.find((s) => s.schedule_id === next.schedule_id);
    if (match) return match as SessionWithBatch;
  }
  if (sessions.length === 0) return null;
  return ([...sessions].sort((a, b) => sessionStart(a).getTime() - sessionStart(b).getTime())[0] ??
    null) as SessionWithBatch | null;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "today" / "tomorrow" when the date is one of those, else null. */
export function relativeDay(date: Date, now: Date): "today" | "tomorrow" | null {
  if (sameDay(date, now)) return "today";
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return sameDay(date, tomorrow) ? "tomorrow" : null;
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(getActiveLocale(), { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatWeekdayDate(date: Date): string {
  return new Intl.DateTimeFormat(getActiveLocale(), { weekday: "short", day: "numeric", month: "short" }).format(date);
}

/**
 * The class's weekly days and time, from its upcoming occurrences, in the
 * learner's clock: e.g. { days: ["Mon", "Wed"], time: "8:00 PM" }. Null when
 * the occurrences do not repeat on fixed days (fewer than two, or the start
 * time moves).
 */
export function weeklyPattern(
  sessions: SessionDetails[],
  sessionId: string
): { days: string[]; time: string } | null {
  const starts = sessions
    .filter((s) => s.session_id === sessionId)
    .map(sessionStart)
    .filter((d) => !Number.isNaN(d.getTime()));
  if (starts.length < 2) return null;
  const minutes = new Set(starts.map((d) => d.getHours() * 60 + d.getMinutes()));
  if (minutes.size !== 1) return null;
  // Monday-first order, whatever day the list starts on.
  const byDay = new Map<number, Date>();
  for (const d of starts) if (!byDay.has(d.getDay())) byDay.set(d.getDay(), d);
  const order = [...byDay.keys()].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const dayName = new Intl.DateTimeFormat(getActiveLocale(), { weekday: "short" });
  return { days: order.map((d) => dayName.format(byDay.get(d)!)), time: formatTime(starts[0]!) };
}

/** The first teacher's name on the class, if the API resolved one. */
export function teacherName(session: SessionDetails): string | null {
  const name = session.instructors?.find((i) => i.full_name?.trim())?.full_name?.trim();
  return name || null;
}
