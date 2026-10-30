import * as XLSX from 'xlsx';
import type { TFunction } from 'i18next';
import type { EngagementDailyReport } from '@/services/engagement-daily-report';
import { failedSectionNames, partFailed } from './report-errors';
import { DASH, exportFileName } from './report-format';
import { formatPeriodDates, type ReportPeriod } from './report-period';
import { rangeT } from './report-range-t';
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

/** The period an export covers, from the report it was built from. */
export const exportPeriod = (data: EngagementDailyReport): ReportPeriod => ({
    from: data.from,
    to: data.to,
});

/** "29 Oct 2026", or "12 Oct – 29 Oct 2026 (18 days)" for a range. */
export const exportPeriodText = (data: EngagementDailyReport, t: TFunction): string => {
    const dates = formatPeriodDates(exportPeriod(data));
    return data.days > 1 ? `${dates} (${t('period.days', { count: data.days })})` : dates;
};

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
 * Excel workbook of the whole report: a Summary sheet (the period, the headline numbers and
 * any warnings), a Trend sheet with a row per day, then one sheet per table or stat block,
 * built from the same specs as the page. Named after the engine and the period.
 */
export const exportReportExcel = ({
    data,
    view,
    engineName,
    t: plainT,
}: ReportExportInput): void => {
    const t = rangeT(plainT, data.days > 1);
    const name = sheetNamer();
    const wb = XLSX.utils.book_new();

    const summary: Cell[][] = [
        [t('export.titleWithPeriod', { period: formatPeriodDates(exportPeriod(data)) })],
        [t('export.engine'), engineName],
        [data.days > 1 ? t('export.period') : t('export.date'), exportPeriodText(data, t)],
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

    if (data.trend.length > 0 && !partFailed(data.errors, 'trend')) {
        const trend: Cell[][] = [
            [
                t('export.date'),
                t('trend.series.sent'),
                t('trend.series.replies'),
                t('trend.series.demosBooked'),
                t('trend.series.credits'),
            ],
            ...data.trend.map((p): Cell[] => [p.date, p.sent, p.replies, p.demosBooked, p.credits]),
        ];
        XLSX.utils.book_append_sheet(wb, sheet(trend), name(t('sheet.trend')));
    }

    buildExportTables(view.model, data, t).forEach((table) => {
        XLSX.utils.book_append_sheet(wb, sheet([table.head, ...table.body]), name(table.sheetName));
    });

    XLSX.writeFile(wb, exportFileName(engineName, exportPeriod(data), 'xlsx', data.engineId));
};
