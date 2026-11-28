import type { TFunction } from 'i18next';
import type { EngagementDiagnosis } from '@/services/engagement-diagnosis';
import { stageRow, stageStatusKey } from './diagnosis-stages';
import type { DiagnosisViewModel } from './use-diagnosis-view';
import {
    statsToExport,
    tableToExport,
    type ExportTable,
    type ReportStatsSpec,
    type ReportTableSpec,
} from './report-tables';
import type { ReportKpi } from './report-kpis';
import type { ReportPeriod } from './report-period';

/*
 * The weekly page flattened for the Excel and PDF exports: the same tables the screen shows
 * (problems, one line per stage, what could not be seen, then each stage's weekly tables), built
 * from the same specs, so a file can never differ from the page.
 */

export interface WeeklyExportInput {
    diagnosis: EngagementDiagnosis;
    view: DiagnosisViewModel;
    /** The week's headline numbers, from the report for the same week. Empty when it did not load. */
    kpis: ReportKpi[];
    /** The engine's name as shown on the page ("All engines" when none is picked). */
    engineName: string;
    t: TFunction;
}

export const weeklyPeriod = (d: Pick<EngagementDiagnosis, 'from' | 'to'>): ReportPeriod => ({
    from: d.from,
    to: d.to,
});

const plain = (key: string, head: string[], rows: string[][], t: TFunction): ExportTable => ({
    key: 'diagnosis',
    title: t(`diagnosis.export.${key}.title`),
    sheetName: t(`diagnosis.export.${key}.sheet`),
    head,
    numeric: head.map(() => false),
    body: rows,
    display: rows,
});

/** Every non-empty table, in page order. A stage that could not be read gets no tables, only its status line. */
export const buildWeeklyExportTables = ({
    diagnosis,
    view,
    t,
}: Pick<WeeklyExportInput, 'diagnosis' | 'view' | 't'>): ExportTable[] => {
    const out: ExportTable[] = [];
    const weekly = view.weekly;
    const readable = (stage: string) => {
        const row = stageRow(diagnosis.stages, stage);
        return !row || stageStatusKey(row.status) !== 'UNAVAILABLE';
    };
    const add = (table: ExportTable | null, include = true) => {
        if (table && include && table.body.length > 0) out.push(table);
    };

    add(
        plain(
            'problems',
            [
                t('diagnosis.export.severity'),
                t('diagnosis.export.stage'),
                t('diagnosis.export.problem'),
                t('diagnosis.export.evidence'),
                t('diagnosis.export.advice'),
            ],
            view.problems.map((p) => [
                t(`diagnosis.severity.${p.severity}`),
                p.stageLabel,
                p.title,
                [p.evidence, ...p.breakdown.map((b) => `${b.label} ${b.count}`)]
                    .filter(Boolean)
                    .join('. '),
                p.advice,
            ]),
            t
        )
    );
    add(
        plain(
            'stages',
            [t('diagnosis.export.stage'), t('diagnosis.export.status')],
            view.stages.map((s) => [s.label, s.statusLabel]),
            t
        )
    );
    add(
        plain(
            'gaps',
            [t('diagnosis.export.note')],
            view.gaps.map((g) => [g]),
            t
        )
    );

    if (!weekly) return out;
    const table = <R>(spec: ReportTableSpec<R>, stage: string) =>
        add(tableToExport(spec), readable(stage));
    const stats = (spec: ReportStatsSpec | null, stage: string) =>
        spec && add(statsToExport(spec, t), readable(stage));

    table(weekly.sources, 'LEADS');
    table(weekly.callHours, 'CALLING');
    if (weekly.callLengths) table(weekly.callLengths, 'CALLING');
    stats(weekly.callStats, 'CALLING');
    if (weekly.callOutcomes) table(weekly.callOutcomes, 'CALLING');
    if (weekly.objections) table(weekly.objections, 'CALLING');
    table(weekly.whatsappFailures, 'WHATSAPP');
    table(weekly.whatsappTemplates, 'WHATSAPP');
    table(weekly.emailSubjects, 'EMAIL');
    stats(weekly.engineChecks, 'ENGINE');
    table(weekly.promptChanges, 'ENGINE');
    return out;
};
