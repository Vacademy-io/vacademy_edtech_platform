import { useQuery } from '@tanstack/react-query';
import {
    addDays,
    differenceInCalendarDays,
    format,
    isValid,
    parseISO,
    startOfWeek,
    subDays,
} from 'date-fns';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type {
    PanelUsageMultiRow,
    PanelUsageQuery,
    PanelUsageResponse,
    PanelUsageSessionEvent,
    PanelUsageSessionRow,
    PanelUsageSessionsQuery,
    PanelUsageSessionsResponse,
    PanelUsageTotals,
} from '@/classroom-shared/apiTypes';
import { PANEL_ADMIN_URL } from '../featureProbe';

/**
 * Usage report reads (GET /admin/usage, /usage/sessions, /usage/multi).
 *
 * Definitions are the server's (panel hours, counted sessions, idle rooms, coverage); the
 * console only shows them. Dates are inclusive local dates in the viewer's time zone.
 */

/** The longest range the server answers. A longer custom range is refused here first. */
export const USAGE_MAX_DAYS = 92;
/** The server caches each answer for a few minutes, so asking again sooner shows nothing new. */
export const USAGE_STALE_MS = 5 * 60_000;
/** Rows per page in the session drawer. */
export const SESSIONS_PAGE_SIZE = 20;
/** The largest page the sessions endpoint serves. */
export const SESSIONS_MAX_PAGE_SIZE = 200;
/** Ids per /usage/multi call; the server refuses more. */
export const MULTI_MAX_INSTITUTES = 50;

export type UsagePreset = 'last7' | 'thisWeek' | 'lastWeek' | 'last30' | 'term';
export type UsageRangeChoice = UsagePreset | 'custom';

export const USAGE_PRESETS: readonly UsagePreset[] = [
    'last7',
    'thisWeek',
    'lastWeek',
    'last30',
    'term',
];

/** Inclusive local dates, yyyy-MM-dd. */
export interface UsageRange {
    from: string;
    to: string;
}

const DAY = 'yyyy-MM-dd';
const day = (date: Date) => format(date, DAY);

/** A preset's dates, counted back from `today`. Weeks start on Monday. */
export function presetRange(preset: UsagePreset, today: Date = new Date()): UsageRange {
    switch (preset) {
        case 'thisWeek':
            return { from: day(startOfWeek(today, { weekStartsOn: 1 })), to: day(today) };
        case 'lastWeek': {
            const start = subDays(startOfWeek(today, { weekStartsOn: 1 }), 7);
            return { from: day(start), to: day(addDays(start, 6)) };
        }
        case 'last30':
            return { from: day(subDays(today, 29)), to: day(today) };
        case 'term':
            return { from: day(subDays(today, USAGE_MAX_DAYS - 1)), to: day(today) };
        case 'last7':
        default:
            return { from: day(subDays(today, 6)), to: day(today) };
    }
}

/** The range the tab opens on. The tab-visibility probe asks for the same one. */
export const DEFAULT_PRESET: UsagePreset = 'last7';
export const defaultUsageRange = (): UsageRange => presetRange(DEFAULT_PRESET);

/** A local yyyy-MM-dd date, or null. */
export function parseDay(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = parseISO(value);
    return isValid(date) ? date : null;
}

/** Days in an inclusive range; 0 when either end is not a date. */
export function rangeDays(range: UsageRange): number {
    const from = parseDay(range.from);
    const to = parseDay(range.to);
    if (!from || !to) return 0;
    return differenceInCalendarDays(to, from) + 1;
}

export type RangeProblem = 'incomplete' | 'order' | 'tooLong';

/** Why a range cannot be asked for, or null when it can. */
export function rangeProblem(range: UsageRange): RangeProblem | null {
    if (!parseDay(range.from) || !parseDay(range.to)) return 'incomplete';
    const days = rangeDays(range);
    if (days < 1) return 'order';
    if (days > USAGE_MAX_DAYS) return 'tooLong';
    return null;
}

/** Every date of a valid range, oldest first (at most USAGE_MAX_DAYS of them). */
export function datesInRange(range: UsageRange): string[] {
    const from = parseDay(range.from);
    const days = Math.min(rangeDays(range), USAGE_MAX_DAYS);
    if (!from || days < 1) return [];
    return Array.from({ length: days }, (_, index) => day(addDays(from, index)));
}

// --------------------------------------------------------------- reads ---

/**
 * The shared client turns a 5xx with no legacy error fields into a bare Error, which would lose
 * BUSY and TRY_AGAIN, so 5xx answers come back as responses and are rethrown in the same shape
 * as any other failed call.
 */
const KEEP_5XX = { validateStatus: (status: number) => status < 300 || status >= 500 };

function body<T>(response: { status?: number; data: T }): T {
    if ((response.status ?? 200) >= 500) throw { response };
    return response.data;
}

export const usageKeys = {
    all: ['classroom-panels', 'usage'] as const,
    summary: (instituteId: string, range: UsageRange, tz: string) =>
        ['classroom-panels', 'usage', 'summary', instituteId, range.from, range.to, tz] as const,
    sessions: (query: PanelUsageSessionsQuery) =>
        [
            'classroom-panels',
            'usage',
            'sessions',
            query.institute_id,
            query.from,
            query.to,
            query.tz,
            query.room_id ?? null,
            query.user_id ?? null,
            query.page ?? 0,
            query.size ?? SESSIONS_PAGE_SIZE,
        ] as const,
    multi: (instituteIds: string[], range: UsageRange, tz: string) =>
        [
            'classroom-panels',
            'usage',
            'multi',
            instituteIds.join(','),
            range.from,
            range.to,
            tz,
        ] as const,
};

const asObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
const num = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value : fallback;

function normaliseTotals(value: unknown): PanelUsageTotals {
    const totals = asObject(value);
    return {
        panel_hours: num(totals.panel_hours),
        sessions: num(totals.sessions),
        teachers: num(totals.teachers),
        rooms_used: num(totals.rooms_used),
        rooms_with_panel: num(totals.rooms_with_panel),
        idle_rooms: num(totals.idle_rooms),
        classes_started: num(totals.classes_started),
        coverage_pct: typeof totals.coverage_pct === 'number' ? totals.coverage_pct : null,
    };
}

/** Every field present, so the tab never trips over a partial answer. */
export function normaliseUsage(raw: unknown, query: PanelUsageQuery): PanelUsageResponse {
    const data = asObject(raw);
    const notes = asObject(data.notes);
    return {
        institute_id: text(data.institute_id, query.institute_id),
        from: text(data.from, query.from),
        to: text(data.to, query.to),
        tz: text(data.tz, query.tz),
        generated_at: text(data.generated_at, ''),
        totals: normaliseTotals(data.totals),
        by_day: list(data.by_day),
        by_room: list(data.by_room),
        by_teacher: list(data.by_teacher),
        idle_rooms: list(data.idle_rooms),
        content: list(data.content),
        notes: {
            content_recorded_from:
                typeof notes.content_recorded_from === 'string'
                    ? notes.content_recorded_from
                    : null,
        },
    };
}

export async function fetchUsage(query: PanelUsageQuery): Promise<PanelUsageResponse> {
    const raw = body(
        await authenticatedAxiosInstance.get<unknown>(`${PANEL_ADMIN_URL}/usage`, {
            ...KEEP_5XX,
            params: query,
        })
    );
    return normaliseUsage(raw, query);
}

export async function fetchUsageSessions(
    query: PanelUsageSessionsQuery
): Promise<PanelUsageSessionsResponse> {
    const params: Record<string, string | number> = {
        institute_id: query.institute_id,
        from: query.from,
        to: query.to,
        tz: query.tz,
        page: query.page ?? 0,
        size: Math.min(query.size ?? SESSIONS_PAGE_SIZE, SESSIONS_MAX_PAGE_SIZE),
    };
    if (query.room_id) params.room_id = query.room_id;
    if (query.user_id) params.user_id = query.user_id;
    const data = asObject(
        body(
            await authenticatedAxiosInstance.get<unknown>(`${PANEL_ADMIN_URL}/usage/sessions`, {
                ...KEEP_5XX,
                params,
            })
        )
    );
    const sessions = list<PanelUsageSessionRow>(data.sessions).map((row) => ({
        ...row,
        events: list<PanelUsageSessionEvent>(row.events),
    }));
    return {
        sessions,
        page: num(data.page),
        size: num(data.size) || (params.size as number),
        total: num(data.total),
    };
}

export async function fetchUsageMulti(
    instituteIds: string[],
    range: UsageRange,
    tz: string
): Promise<PanelUsageMultiRow[]> {
    const data = body(
        await authenticatedAxiosInstance.get<unknown>(`${PANEL_ADMIN_URL}/usage/multi`, {
            ...KEEP_5XX,
            params: {
                institute_ids: instituteIds.slice(0, MULTI_MAX_INSTITUTES).join(','),
                from: range.from,
                to: range.to,
                tz,
            },
        })
    );
    return list<unknown>(data).map((row) => {
        const value = asObject(row);
        return {
            institute_id: text(value.institute_id, ''),
            totals: normaliseTotals(value.totals),
        };
    });
}

/**
 * The usage summary for one range. The tab-visibility probe reads the same key for the default
 * range, so opening the tab reuses that answer instead of asking twice.
 */
export function useUsageQuery(
    instituteId: string,
    range: UsageRange,
    tz: string,
    options: { enabled?: boolean; staleTime?: number } = {}
) {
    return useQuery({
        queryKey: usageKeys.summary(instituteId, range, tz),
        retry: false,
        enabled: options.enabled ?? true,
        staleTime: options.staleTime ?? USAGE_STALE_MS,
        queryFn: () =>
            fetchUsage({ institute_id: instituteId, from: range.from, to: range.to, tz }),
    });
}

// ----------------------------------------------------------- formatting ---

/** "1 h 35 min" / "35 min" from whole minutes, through the caller's translations. */
export function durationLabel(
    t: (key: string, vars?: Record<string, unknown>) => string,
    minutes: number
): string {
    const total = Math.max(0, Math.round(minutes));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return hours > 0
        ? t('usage.duration.hm', { h: hours, m: rest })
        : t('usage.duration.m', { m: rest });
}
