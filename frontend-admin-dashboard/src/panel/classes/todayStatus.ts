/**
 * Labels on a Today card, all from server time. `time_label` is displayed as it came,
 * and clock times the panel has to print itself are built from the server's own numbers,
 * because neither the panel's clock nor its Intl data can be trusted.
 */
import type { TodayClass } from '@/classroom-shared/apiTypes';

export type ClassStatus =
    | { kind: 'now' }
    | { kind: 'soon'; minutes: number }
    | { kind: 'done' }
    | { kind: 'later' };

/** Further ahead than this and the time on the card says enough. */
const SOON_WITHIN_MS = 60 * 60 * 1000;

export function classStatus(item: TodayClass, serverNowMs: number): ClassStatus {
    const ends = item.ends_at_ms;
    if (typeof ends === 'number' && serverNowMs >= ends) return { kind: 'done' };
    // With no end time a started class stays current: only the day's list ends it.
    if (serverNowMs >= item.starts_at_ms) return { kind: 'now' };
    const left = item.starts_at_ms - serverNowMs;
    if (left <= SOON_WITHIN_MS) return { kind: 'soon', minutes: Math.ceil(left / 60000) };
    return { kind: 'later' };
}

/** Same fallback zone the server uses for a row it cannot parse. */
const DEFAULT_ZONE_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_ZONE_OFFSET_MS = 14 * 60 * 60 * 1000;

/**
 * The session zone's offset from UTC for this row, worked out from its own fields:
 * `meeting_date` and `time_label` are wall clock there, `starts_at_ms` is the instant.
 */
export function zoneOffsetOf(item: TodayClass | undefined): number {
    if (!item) return DEFAULT_ZONE_OFFSET_MS;
    const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(item.meeting_date ?? '');
    const time = /^(\d{1,2}):(\d{2})/.exec(item.time_label ?? '');
    if (!date || !time) return DEFAULT_ZONE_OFFSET_MS;
    const wall = Date.UTC(+date[1]!, +date[2]! - 1, +date[3]!, +time[1]!, +time[2]!);
    const offset = wall - item.starts_at_ms;
    return Number.isFinite(offset) && Math.abs(offset) <= MAX_ZONE_OFFSET_MS
        ? offset
        : DEFAULT_ZONE_OFFSET_MS;
}

function pad(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

/** yyyy-mm-dd of an instant in that zone. */
export function zonedDay(instantMs: number, zoneOffsetMs: number): string {
    const at = new Date(instantMs + zoneOffsetMs);
    return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** HH:mm of an instant in that zone. */
export function zonedTime(instantMs: number, zoneOffsetMs: number): string {
    const at = new Date(instantMs + zoneOffsetMs);
    return `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}
