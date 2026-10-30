import * as XLSX from 'xlsx';
import type { ReportItemRow } from '@/services/engagement-daily-report';
import { fileSlug } from '../../-utils/report-format';
import { periodFileTag, type ReportPeriod } from '../../-utils/report-period';
import { sheet, type Cell } from '../../-utils/report-export';
import type { OutcomeColumn } from './outcomes-columns';

export interface OutcomesExportInput {
    columns: OutcomeColumn[];
    rows: ReportItemRow[];
    /** Becomes the worksheet's name (Excel allows 31 characters, none of \ / ? * [ ] :). */
    sheetName: string;
    /** The list's tab key: leads, demos, status or conversions. */
    tab: string;
    engineName: string;
    engineId: string | null;
    /** The day, or the range of days, the list covers. */
    period: ReportPeriod;
}

/**
 * engagement-<tab>-<engine>-<day>.xlsx, or engagement-<tab>-<engine>-<from>_to_<to>.xlsx for a
 * range. An engine whose name has no Latin letters or digits is named by the first 8
 * characters of its id; "all" is for the all-engines list.
 */
export const outcomesFileName = (
    input: Omit<OutcomesExportInput, 'columns' | 'rows' | 'sheetName'>
) => {
    const slug =
        fileSlug(input.engineName) ||
        (input.engineId ? fileSlug(input.engineId.slice(0, 8)) || 'engine' : 'all');
    return `engagement-${input.tab}-${slug}-${periodFileTag(input.period)}.xlsx`;
};

/**
 * One Excel sheet of a Leads & outcomes list: a header row, then a row per person, with the
 * same columns as the screen (times in the institute's time zone, as "2026-10-30 14:05").
 */
export const exportOutcomesExcel = (input: OutcomesExportInput): void => {
    const body: Cell[][] = input.rows.map((row) =>
        input.columns.map((c): Cell => (c.value ? c.value(row) : c.text(row)))
    );
    const wb = XLSX.utils.book_new();
    const name =
        input.sheetName
            .replace(/[\\/?*[\]:]/g, ' ')
            .trim()
            .slice(0, 31) || 'Sheet';
    XLSX.utils.book_append_sheet(wb, sheet([input.columns.map((c) => c.header), ...body]), name);
    XLSX.writeFile(wb, outcomesFileName(input));
};
