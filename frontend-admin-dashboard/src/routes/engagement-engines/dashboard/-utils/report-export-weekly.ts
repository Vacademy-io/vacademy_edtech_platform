import * as XLSX from 'xlsx';
import { buildWeeklyExportTables, weeklyPeriod, type WeeklyExportInput } from './diagnosis-export';
import { type Cell, sheet, sheetNamer } from './report-export';
import { DASH, exportFileName } from './report-format';
import { formatPeriodDates } from './report-period';
import { rangeT } from './report-range-t';

/**
 * Excel workbook of the weekly page: a Summary sheet (the week, the headline numbers), then the
 * problems, the status of each stage, and one sheet per weekly table, built from the same
 * descriptions as the page. Named after the engine and the week.
 */
export const exportWeeklyExcel = (input: WeeklyExportInput): void => {
    const { diagnosis, kpis, engineName } = input;
    const t = rangeT(input.t, true);
    const name = sheetNamer();
    const wb = XLSX.utils.book_new();
    const period = weeklyPeriod(diagnosis);

    const summary: Cell[][] = [
        [t('diagnosis.export.titleWeekly', { period: formatPeriodDates(period) })],
        [t('export.engine'), engineName],
        [t('export.period'), formatPeriodDates(period)],
        [t('export.timezone'), diagnosis.timezone || DASH],
        [t('export.generatedAt'), diagnosis.generatedAt || DASH],
    ];
    if (kpis.length > 0) {
        summary.push(
            [],
            [t('export.metric'), t('export.value'), t('export.detail')],
            ...kpis.map((k): Cell[] => [k.label, k.value, k.detail ?? ''])
        );
    }
    XLSX.utils.book_append_sheet(wb, sheet(summary), name(t('sheet.summary')));

    buildWeeklyExportTables({ diagnosis, view: input.view, t }).forEach((table) => {
        XLSX.utils.book_append_sheet(wb, sheet([table.head, ...table.body]), name(table.sheetName));
    });

    XLSX.writeFile(
        wb,
        exportFileName(engineName, period, 'xlsx', diagnosis.engineId).replace(
            /^engagement-report-/,
            'engagement-weekly-'
        )
    );
};
