/**
 * The last Today list, kept for the offline state. One entry per teacher, holding one
 * session day: a list from another day, another institute or another teacher is never
 * returned. Nothing here is read on a signed-out screen.
 *
 * "Which day is it" comes from server time plus the zone offset of the stored rows. A
 * panel whose clock has since jumped gets no list back, which is the safe direction.
 */
import type { TodayClass, TodayScope } from '@/classroom-shared/apiTypes';
import { readJson, removeKey, writeJson } from '../lib/storage';
import { zoneOffsetOf, zonedDay } from './todayStatus';

const STORAGE_KEY = 'panel.classes.today';
const MAX_TEACHERS = 5;

export interface StoredTodayList {
    classes: TodayClass[];
    truncated: boolean;
    server_time_ms: number;
    /** Server time minus local time when this answer arrived. */
    offset_ms: number;
    zone_offset_ms: number;
}

interface TeacherEntry {
    institute_id: string;
    day: string;
    saved_at: number;
    mine?: StoredTodayList;
    all?: StoredTodayList;
}

type CacheFile = Record<string, TeacherEntry>;

export function makeStoredList(
    classes: TodayClass[],
    truncated: boolean,
    serverTimeMs: number,
    localNowMs: number = Date.now()
): StoredTodayList {
    return {
        classes,
        truncated,
        server_time_ms: serverTimeMs,
        offset_ms: serverTimeMs - localNowMs,
        zone_offset_ms: zoneOffsetOf(classes[0]),
    };
}

/** Whether this list still describes today, by the server time it came with. */
export function isListCurrent(list: StoredTodayList, localNowMs: number = Date.now()): boolean {
    return (
        zonedDay(localNowMs + list.offset_ms, list.zone_offset_ms) ===
        zonedDay(list.server_time_ms, list.zone_offset_ms)
    );
}

function readFile(): CacheFile {
    const file = readJson<CacheFile>(STORAGE_KEY);
    return file && typeof file === 'object' ? file : {};
}

export function readTodayList(
    userId: string,
    instituteId: string,
    scope: TodayScope,
    localNowMs: number = Date.now()
): StoredTodayList | null {
    const file = readFile();
    const entry = Object.prototype.hasOwnProperty.call(file, userId) ? file[userId] : undefined;
    if (!entry || entry.institute_id !== instituteId) return null;
    const list = entry[scope];
    if (!list || !Array.isArray(list.classes) || typeof list.server_time_ms !== 'number') {
        return null;
    }
    if (zonedDay(list.server_time_ms, list.zone_offset_ms) !== entry.day) return null;
    return isListCurrent(list, localNowMs) ? list : null;
}

/** An empty list clears that scope: there is nothing worth showing from it offline. */
export function writeTodayList(
    userId: string,
    instituteId: string,
    scope: TodayScope,
    list: StoredTodayList
): void {
    const day = zonedDay(list.server_time_ms, list.zone_offset_ms);
    const file = readFile();
    const previous = file[userId];
    const entry: TeacherEntry =
        previous && previous.institute_id === instituteId && previous.day === day
            ? { ...previous, saved_at: list.server_time_ms }
            : { institute_id: instituteId, day, saved_at: list.server_time_ms };
    if (list.classes.length > 0) entry[scope] = list;
    else delete entry[scope];

    const next: CacheFile = { [userId]: entry };
    Object.keys(file)
        .filter((id) => id !== userId && file[id]?.day === day)
        .sort((a, b) => (file[b]?.saved_at ?? 0) - (file[a]?.saved_at ?? 0))
        .slice(0, MAX_TEACHERS - 1)
        .forEach((id) => {
            const other = file[id];
            if (other) next[id] = other;
        });
    writeJson(STORAGE_KEY, next);
}

export function clearTodayCache(): void {
    removeKey(STORAGE_KEY);
}
