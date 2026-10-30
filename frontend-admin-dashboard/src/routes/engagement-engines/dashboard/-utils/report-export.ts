import * as XLSX from 'xlsx';
import type { TFunction } from 'i18next';
import type { EngagementDailyReport } from '@/services/engagement-daily-report';
import { failedSectionNames } from './report-errors';
import { DASH, exportFileName, formatDay } from './report-format';
import { buildExportTables } from './report-tables';
import type { ReportView } from './use-report-model';

export interface ReportExportInput {
    data: EngagementDailyReport;
    view: ReportView;
    /** The engine's name as shown on the page ("All engines" when none is picked). */
    engineName: string;
    t: TFunction;
}

export type Cell = string | number | null;

/** Excel sheet names: 31 characters at most, none of  \ / ? * [ ] :  and no repeats. */
const sheetNamer = () => {
    const used = new Set<string>();
    return (name: string) => {
        const base =
            name
                .replace(/[\\/?*[\]:]/g, ' ')
                .trim()
                .slice(0, 31) || 'Sheet';
        let candidate = base;
        let n = 2;
        while (used.has(candidate.toLowerCase())) {
            const suffix = ` ${n++}`;
            candidate = base.slice(0, 31 - suffix.length) + suffix;
        }
        used.add(candidate.toLowerCase());
        return candidate;
    };
};

const columnWidths = (rows: Cell[][]) => {
    const columns = Math.max(0, ...rows.map((r) => r.length));
    return Array.from({ length: columns }, (_, i) => ({
        wch: Math.min(48, Math.max(8, ...rows.map((r) => String(r[i] ?? '').length)) + 2),
    }));
};

/** One worksheet from rows of cells, its columns as wide as their longest value. */
export const sheet = (rows: Cell[][]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = columnWidths(rows);
    return ws;
};

/**
 * Excel workbook of the whole report: a Summary sheet (the headline numbers and any
 * warnings), then one sheet per table or stat block, built from the same specs as the page.
 */
export const exportReportExcel = ({ data, view, engineName, t }: ReportExportInput): void => {
    const name = sheetNamer();
    const wb = XLSX.utils.book_new();

    const summary: Cell[][] = [
        [t('export.pdfTitle')],
        [t('export.engine'), engineName],
        [t('export.date'), formatDay(data.date)],
        [t('export.timezone'), data.timezone || DASH],
        [t('export.generatedAt'), data.generatedAt || DASH],
        [],
        [t('export.metric'), t('export.value'), t('export.detail')],
        ...view.kpis.map((k): Cell[] => [k.label, k.value, k.detail ?? '']),
    ];
    if (view.banners.length > 0) {
        summary.push([], [t('export.severity.title'), t('export.warning')]);
        view.banners.forEach((b) =>
            summary.push([t(`export.severity.${b.severity}`), `${b.title}. ${b.text}`])
        );
    }
    if (Object.keys(data.errors).length > 0) {
        summary.push([], [t('export.failedSections'), failedSectionNames(data.errors, t)]);
    }
    XLSX.utils.book_append_sheet(wb, sheet(summary), name(t('sheet.summary')));

    buildExportTables(view.model, data, t).forEach((table) => {
        XLSX.utils.book_append_sheet(wb, sheet([table.head, ...table.body]), name(table.sheetName));
    });

    XLSX.writeFile(wb, exportFileName(engineName, data.date, 'xlsx', data.engineId));
};
