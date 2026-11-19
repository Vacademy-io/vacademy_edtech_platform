import { COUNT_TOTALS, MONEY_TOTALS } from './report-keys';
import type { ReportAnswer, ReportColumn, ReportColumnType, ReportRow, ReportSection } from './report-types';

/**
 * How the server's columns and totals are read on screen (lead decisions 2–4):
 * the server's labels, its `*_text` columns in place of the raw figures, and
 * totals drawn by the type of the column with the same key.
 */

/**
 * A `*_text` column and the raw column it stands for on screen. The server
 * sends both ("5.9 m" and 5.9; "₹123.40 / m" and 123.40); the screen shows
 * the text and hides the raw companion. The files (CSV, Excel) come from the
 * server and keep both.
 */
const TEXT_REPLACES: Readonly<Record<string, string>> = {
    quantity_text: 'quantity',
    rate_text: 'rate_per_unit',
    sold_text: 'sold',
    returned_text: 'returned',
    net_text: 'net_units',
    average_rate_text: 'average_rate',
};

/** The columns a table shows: every column except a raw quantity or rate whose `*_text` column is there. */
export function screenColumns(columns: ReportColumn[]): ReportColumn[] {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const hidden = new Set<string>();
    columns.forEach((column) => {
        if (!column.key.endsWith('_text')) return;
        const named = TEXT_REPLACES[column.key];
        if (named && byKey.has(named)) hidden.add(named);
        // Any other `<key>_text` beside a QTY or MONEY `<key>`: same rule.
        const raw = byKey.get(column.key.slice(0, -'_text'.length));
        if (raw && (raw.type === 'QTY' || raw.type === 'MONEY')) hidden.add(raw.key);
    });
    return hidden.size === 0 ? columns : columns.filter((column) => !hidden.has(column.key));
}

/** A column's label in the admin's language: `label_hi` in Hindi, `label` in English, else the key. */
export function columnLabel(column: Pick<ReportColumn, 'key' | 'labelEn' | 'labelHi'>, lang: 'en' | 'hi'): string {
    return (lang === 'hi' ? column.labelHi : null) ?? column.labelEn ?? column.key;
}

/** A section's heading: the server's `label_hi` / `label`, else its key. */
export const sectionLabel = (section: Pick<ReportSection, 'key' | 'labelEn' | 'labelHi'>, lang: 'en' | 'hi'): string =>
    columnLabel(section, lang);

/** Every column of an answer: the main table's, then each section's (the lookup for totals beyond a table). */
export const answerColumns = (answer: Pick<ReportAnswer, 'columns' | 'sections'>): ReportColumn[] => [
    ...answer.columns,
    ...answer.sections.flatMap((section) => section.columns),
];

const MONEY_KEYS = new Set<string>(MONEY_TOTALS);
const WORDED_KEYS = new Set<string>([...MONEY_TOTALS, ...COUNT_TOTALS]);

/** The column a totals key belongs to: the table's own first, then any other table of the answer. */
export function totalColumn(key: string, own: ReportColumn[], all: ReportColumn[] = []): ReportColumn | null {
    return own.find((column) => column.key === key) ?? all.find((column) => column.key === key) ?? null;
}

/**
 * The type a totals figure is drawn with: its column's type; a key that is
 * not a column is a count (plain integer), unless the server names it as
 * money (`MONEY_TOTALS`).
 */
export function totalType(key: string, own: ReportColumn[], all: ReportColumn[] = []): ReportColumnType {
    const column = totalColumn(key, own, all);
    if (column) return column.type;
    return MONEY_KEYS.has(key) ? 'MONEY' : 'INT';
}

/** True when the screen has its own words for a totals key that is not a column. */
export const isWordedTotal = (key: string): boolean => WORDED_KEYS.has(key);

/** Totals keys that are not a column of the table, in the server's order; `omit` leaves out figures shown elsewhere. */
export function extraTotals(columns: ReportColumn[], totals: ReportRow | null, omit: readonly string[] = []): [string, unknown][] {
    if (!totals) return [];
    const keys = new Set(columns.map((c) => c.key));
    return Object.entries(totals).filter(
        ([key, value]) => !keys.has(key) && !omit.includes(key) && value !== null && value !== undefined && typeof value !== 'object'
    );
}
