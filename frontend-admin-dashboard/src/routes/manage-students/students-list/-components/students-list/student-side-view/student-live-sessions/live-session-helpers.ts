import { addDays, format, parse } from 'date-fns';
import type { LearnerLiveClass } from '@/services/learner-live-sessions';

/** Same fallback the live-session cards and the backend queries use. */
export const DEFAULT_SESSION_TIMEZONE = 'Asia/Kolkata';

export const toYmd = (d: Date) => format(d, 'yyyy-MM-dd');

export const fromYmd = (ymd: string) => parse(ymd, 'yyyy-MM-dd', new Date());

/** The viewer's timezone, used to decide whether to label a time with the session's zone. */
export const browserTimezone = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return DEFAULT_SESSION_TIMEZONE;
    }
};

/** "42 min" / "1h 05m". */
export const formatMinutes = (mins: number | null | undefined) => {
    if (mins == null || Number.isNaN(mins)) return '—';
    const rounded = Math.round(mins);
    if (rounded < 60) return `${rounded} min`;
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
};

// ── Attendance by day ────────────────────────────────────────────────────────

/**
 * How a learner did on one calendar day that had at least one class. Deliberately two states so
 * the calendar reads at a glance:
 * - attended: present at one or more classes that day
 * - unmarked: no class attended — marked absent, or attendance not recorded yet
 */
export type DayStatus = 'attended' | 'unmarked';

export interface DaySummary {
    date: string;
    status: DayStatus;
    classes: LearnerLiveClass[];
}

/** Classes grouped by their (session-local) meeting date. */
export const summariseByDay = (classes: LearnerLiveClass[]): Map<string, DaySummary> => {
    const byDate = new Map<string, LearnerLiveClass[]>();
    for (const c of classes) {
        const list = byDate.get(c.meeting_date) ?? [];
        list.push(c);
        byDate.set(c.meeting_date, list);
    }
    const out = new Map<string, DaySummary>();
    for (const [date, list] of byDate) {
        const attended = list.some((c) => c.attendance_status === 'PRESENT');
        out.set(date, { date, status: attended ? 'attended' : 'unmarked', classes: list });
    }
    return out;
};

/**
 * Streaks are counted in CLASS days — days with no class neither extend nor break a streak, so a
 * learner on a Mon/Wed/Fri batch isn't penalised for the days in between.
 *
 * `current` walks back from the most recent class day. Today is skipped until a class is attended,
 * since attendance syncs from the provider after the class ends and an unsynced class shouldn't
 * wipe out the streak in the meantime.
 */
export const computeStreaks = (
    days: Map<string, DaySummary>,
    today: string
): { current: number; longest: number } => {
    const ordered = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));

    let longest = 0;
    let run = 0;
    for (const d of ordered) {
        if (d.status === 'attended') {
            run += 1;
            longest = Math.max(longest, run);
        } else if (!(d.date === today && d.status === 'unmarked')) {
            run = 0;
        }
    }

    let current = 0;
    for (let i = ordered.length - 1; i >= 0; i--) {
        const d = ordered[i]!;
        if (d.date === today && d.status === 'unmarked') continue;
        if (d.status !== 'attended') break;
        current += 1;
    }
    return { current, longest };
};

/** yyyy-MM-dd for each day from `start` through `end`, inclusive. */
export const eachYmd = (start: Date, end: Date): string[] => {
    const out: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(toYmd(d));
    return out;
};
