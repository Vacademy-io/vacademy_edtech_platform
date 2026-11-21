import Papa from 'papaparse';
import type { PanelUsageQuery, PanelUsageSessionRow } from '@/classroom-shared/apiTypes';
import { SESSIONS_MAX_PAGE_SIZE, fetchUsageSessions } from './usageApi';

/** Sessions in one export. Past this the file says so and asks for fewer days. */
export const EXPORT_MAX_ROWS = 5000;

export interface CollectedSessions {
    rows: PanelUsageSessionRow[];
    total: number;
    truncated: boolean;
}

/** Pages through /usage/sessions one request at a time, never past EXPORT_MAX_ROWS. */
export async function collectSessions(
    query: PanelUsageQuery,
    fetchPage: typeof fetchUsageSessions = fetchUsageSessions
): Promise<CollectedSessions> {
    const rows: PanelUsageSessionRow[] = [];
    let total = 0;
    for (let page = 0; rows.length < EXPORT_MAX_ROWS; page++) {
        const answer = await fetchPage({ ...query, page, size: SESSIONS_MAX_PAGE_SIZE });
        total = answer.total;
        rows.push(...answer.sessions);
        if (answer.sessions.length === 0 || rows.length >= total) break;
    }
    const kept = rows.slice(0, EXPORT_MAX_ROWS);
    return { rows: kept, total, truncated: total > kept.length };
}

/**
 * Text cells that start with one of these get a leading apostrophe, so a spreadsheet
 * shows them as text. Only the first character counts, whatever follows on later lines.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export interface CsvLabels {
    columns: {
        date: string;
        room: string;
        teacher: string;
        started: string;
        ended: string;
        minutes: string;
        endReason: string;
        startedVia: string;
        content: string;
    };
    /** Local date and time of an instant. */
    dateTime: (iso: string) => string;
    /** Local date of an instant. */
    date: (iso: string) => string;
    endReason: (row: PanelUsageSessionRow) => string;
    startedVia: (row: PanelUsageSessionRow) => string;
    /** One recorded item, e.g. "Lesson: Photosynthesis (12 min)". */
    event: (event: PanelUsageSessionRow['events'][number]) => string;
}

/**
 * One row per session. Cells starting with = + - @ are kept as text (FORMULA_START), and
 * the BOM lets spreadsheet apps read non-Latin names as UTF-8.
 */
export function sessionsToCsv(rows: PanelUsageSessionRow[], labels: CsvLabels): string {
    const c = labels.columns;
    const fields = [
        c.date,
        c.room,
        c.teacher,
        c.started,
        c.ended,
        c.minutes,
        c.endReason,
        c.startedVia,
        c.content,
    ];
    const data = rows.map((row) => [
        labels.date(row.started_at),
        row.room?.name ?? '',
        row.user?.name ?? '',
        labels.dateTime(row.started_at),
        labels.dateTime(row.end_at),
        Math.round(row.minutes ?? 0),
        labels.endReason(row),
        labels.startedVia(row),
        (row.events ?? []).map(labels.event).join('; '),
    ]);
    return `\uFEFF${Papa.unparse({ fields, data }, { escapeFormulae: FORMULA_START })}`;
}

export const usageCsvFileName = (from: string, to: string): string =>
    `classroom-panel-usage-${from}-to-${to}.csv`;

export interface MultiCsvRow {
    name: string;
    panel_hours: number;
    sessions: number;
    rooms_used: number;
    rooms_with_panel: number;
    teachers: number;
    idle_rooms: number;
}

/** The "My schools" table as a file, one row per school. */
export function multiToCsv(
    rows: MultiCsvRow[],
    columns: {
        school: string;
        hours: string;
        sessions: string;
        roomsUsed: string;
        roomsWithPanel: string;
        teachers: string;
        idle: string;
    }
): string {
    const fields = [
        columns.school,
        columns.hours,
        columns.sessions,
        columns.roomsUsed,
        columns.roomsWithPanel,
        columns.teachers,
        columns.idle,
    ];
    const data = rows.map((row) => [
        row.name,
        Math.round(row.panel_hours * 10) / 10,
        row.sessions,
        row.rooms_used,
        row.rooms_with_panel,
        row.teachers,
        row.idle_rooms,
    ]);
    return `\uFEFF${Papa.unparse({ fields, data }, { escapeFormulae: FORMULA_START })}`;
}
