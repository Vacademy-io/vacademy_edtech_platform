import { parse } from 'date-fns';
import type {
    DashboardClassRow,
    DashboardFeedbackAnswer,
    DashboardDailyPoint,
    DashboardInstructorStats,
} from '../-services/live-class-dashboard';

// ─── Period-over-period deltas ─────────────────────────────────────────────

/**
 * How a KPI moves against the previous period:
 * - `rate`: a 0..1 fraction, compared in percentage points;
 * - `relative`: a count or duration, compared as % change;
 * - `absolute`: a small-scale value such as a 5-star rating, compared as-is.
 */
export type DeltaKind = 'rate' | 'relative' | 'absolute';

export interface Delta {
    /** Signed amount in the kind's unit (points, %, or raw). */
    value: number;
    direction: 'up' | 'down' | 'flat';
}

const FLAT_BELOW: Record<DeltaKind, number> = { rate: 0.5, relative: 1, absolute: 0.05 };

export const computeDelta = (
    current: number | null | undefined,
    previous: number | null | undefined,
    kind: DeltaKind
): Delta | null => {
    if (current === null || current === undefined || previous === null || previous === undefined) {
        return null;
    }
    let value: number;
    if (kind === 'rate') value = (current - previous) * 100;
    else if (kind === 'relative') {
        if (previous === 0) return null;
        value = ((current - previous) / previous) * 100;
    } else value = current - previous;
    const direction = Math.abs(value) < FLAT_BELOW[kind] ? 'flat' : value > 0 ? 'up' : 'down';
    return { value, direction };
};

/** "+4.2" / "−12" — signed, one decimal for points and ratings, none for %. */
export const formatDeltaValue = (delta: Delta, kind: DeltaKind): string => {
    const digits = kind === 'relative' ? 0 : 1;
    const abs = Math.abs(delta.value).toFixed(digits);
    if (delta.direction === 'flat') return abs;
    return `${delta.value > 0 ? '+' : '−'}${abs}`;
};

// ─── People ─────────────────────────────────────────────────────────────────

export const initialsOf = (name: string | null | undefined): string => {
    const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    const first = words[0]?.[0] ?? '';
    const second = words.length > 1 ? words[words.length - 1]?.[0] ?? '' : '';
    return (first + second).toUpperCase();
};

const AVATAR_TINTS = [
    'bg-primary-100 text-primary-600',
    'bg-info-100 text-info-700',
    'bg-success-100 text-success-700',
    'bg-warning-100 text-warning-700',
] as const;

/** A stable tint per person, so the same teacher keeps one colour everywhere. */
export const avatarTint = (id: string): string => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return AVATAR_TINTS[hash % AVATAR_TINTS.length] ?? AVATAR_TINTS[0];
};

// ─── Insights ───────────────────────────────────────────────────────────────

/** Classes smaller than this are too noisy to call "best" or "worst". */
export const MIN_EXPECTED_FOR_RANKING = 5;
/** A teacher needs this many ratings before being called top-rated. */
export const MIN_RATINGS_FOR_RANKING = 3;

export interface DashboardInsights {
    bestClass: DashboardClassRow | null;
    lowestClass: DashboardClassRow | null;
    topTeacher: DashboardInstructorStats | null;
    zeroJoinClasses: number;
    busiestDay: DashboardDailyPoint | null;
}

export const computeInsights = (
    classes: DashboardClassRow[],
    instructors: DashboardInstructorStats[],
    daily: DashboardDailyPoint[]
): DashboardInsights => {
    const ranked = classes.filter(
        (c) =>
            c.status === 'COMPLETED' &&
            c.expected >= MIN_EXPECTED_FOR_RANKING &&
            c.attendance_rate !== null
    );
    const byRate = [...ranked].sort(
        (a, b) => (b.attendance_rate ?? 0) - (a.attendance_rate ?? 0) || b.expected - a.expected
    );
    const rated = instructors.filter(
        (i) => i.avg_rating !== null && i.feedback_count >= MIN_RATINGS_FOR_RANKING
    );
    const topTeacher =
        [...rated].sort(
            (a, b) =>
                (b.avg_rating ?? 0) - (a.avg_rating ?? 0) || b.feedback_count - a.feedback_count
        )[0] ?? null;
    const busiestDay =
        [...daily].filter((d) => d.classes > 0).sort((a, b) => b.classes - a.classes)[0] ?? null;

    return {
        bestClass: byRate[0] ?? null,
        lowestClass: byRate.length > 1 ? byRate[byRate.length - 1] ?? null : null,
        topTeacher,
        zeroJoinClasses: classes.filter(
            (c) => c.status === 'COMPLETED' && c.expected > 0 && c.joined === 0
        ).length,
        busiestDay,
    };
};

// ─── Schedule heatmap (weekday × start hour) ───────────────────────────────

export interface HeatCell {
    classes: number;
    expected: number;
    present: number;
}

export interface Heatmap {
    /** Hours (0-23) that have at least one class, contiguous from first to last. */
    hours: number[];
    /** Key `${weekday}-${hour}`, weekday 0 = Monday. */
    cells: Map<string, HeatCell>;
    maxClasses: number;
}

export const heatKey = (weekday: number, hour: number) => `${weekday}-${hour}`;

export const buildHeatmap = (classes: DashboardClassRow[]): Heatmap => {
    const cells = new Map<string, HeatCell>();
    let minHour = 24;
    let maxHour = -1;
    let maxClasses = 0;
    for (const c of classes) {
        if (!c.start_time) continue;
        const date = parse(c.meeting_date, 'yyyy-MM-dd', new Date());
        const hour = Number(c.start_time.slice(0, 2));
        if (Number.isNaN(date.getTime()) || Number.isNaN(hour)) continue;
        const weekday = (date.getDay() + 6) % 7;
        const key = heatKey(weekday, hour);
        const cell = cells.get(key) ?? { classes: 0, expected: 0, present: 0 };
        cell.classes += 1;
        if (c.status === 'COMPLETED' && c.attendance_rate !== null && c.expected > 0) {
            cell.expected += c.expected;
            cell.present += Math.round(c.attendance_rate * c.expected);
        }
        cells.set(key, cell);
        minHour = Math.min(minHour, hour);
        maxHour = Math.max(maxHour, hour);
        maxClasses = Math.max(maxClasses, cell.classes);
    }
    const hours: number[] = [];
    for (let h = minHour; h <= maxHour; h++) hours.push(h);
    return { hours, cells, maxClasses };
};

/** 0 for an empty cell, else 1..5 by share of the busiest cell. */
export const heatLevel = (count: number, max: number): number =>
    count <= 0 || max <= 0 ? 0 : Math.min(5, Math.max(1, Math.ceil((count / max) * 5)));

// ─── Feedback ───────────────────────────────────────────────────────────────

const DOUBT_PATTERN = /doubt|question|query|confus/i;
// "No", "none", "nothing", "no doubts" … are answers to the doubts question, not doubts.
const NO_DOUBT =
    /^(no+|none|nothing|nil|na|n\/a|nope|no doubts?|no questions?|not any|-+|\.+|ok|okay)[.!\s]*$/i;

/** A written answer to a doubts-style question that is not just "no". */
export const isDoubt = (c: { answers: DashboardFeedbackAnswer[] }) =>
    c.answers.some(
        (a) =>
            (DOUBT_PATTERN.test(a.question_id) || DOUBT_PATTERN.test(a.label)) &&
            !NO_DOUBT.test(a.text.trim())
    );
