import dayjs from 'dayjs';

/**
 * CSV export for the Learning Reports. A report is several tables (summary,
 * daily activity, leaderboard…), so one file carries them as titled sections
 * separated by a blank line — the shape spreadsheets open cleanly.
 *
 * Values are written raw and numeric where the UI shows a formatted string
 * ("1h 5m 2s" → 65.03, "45.67%" → 45.67) so the columns sort and sum; the
 * unit lives in the header ("(min)", "(%)").
 */

export type CsvValue = string | number | null | undefined;

export interface CsvSection {
    title?: string;
    headers: string[];
    rows: CsvValue[][];
}

const sanitizeCell = (value: CsvValue): string => {
    let s = value == null ? '' : String(value);
    // Neutralize formula injection (=, +, @, leading tab/CR) in spreadsheet apps.
    if (/^[=+@\t\r]/.test(s)) s = `'${s}`;
    // Quote when the value contains a comma, quote or newline.
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
};

const line = (cells: CsvValue[]) => cells.map(sanitizeCell).join(',');

export const buildReportCsv = (sections: CsvSection[]): string =>
    sections
        .map((section) =>
            [
                ...(section.title ? [line([section.title])] : []),
                line(section.headers),
                ...section.rows.map(line),
            ].join('\r\n')
        )
        .join('\r\n\r\n');

export const downloadCsv = (filename: string, content: string): void => {
    // UTF-8 BOM so Excel renders non-ASCII names correctly.
    const bom = String.fromCharCode(0xfeff);
    const blob = new Blob([bom, content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

const slug = (part: string) =>
    part
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

/** "learning-timeline_batch-a_2026-09-15.csv" — empty parts are dropped. */
export const csvFileName = (...parts: Array<string | undefined | null>): string =>
    `${[
        ...parts.filter((p): p is string => Boolean(p && p.trim())).map(slug),
        dayjs().format('YYYY-MM-DD'),
    ]
        .filter(Boolean)
        .join('_')}.csv`;

/** Number rounded to 2 dp, or '' for missing — never the string "NaN". */
export const num = (value: number | string | null | undefined): CsvValue => {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : '';
};

/** ISO-ish date for CSV (sortable), '' when invalid. */
export const csvDate = (value: string | null | undefined): CsvValue =>
    value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD') : '';
