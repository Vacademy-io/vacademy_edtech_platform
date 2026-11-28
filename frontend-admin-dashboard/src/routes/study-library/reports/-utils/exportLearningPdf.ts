import autoTable from 'jspdf-autotable';
import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import {
    createReportDoc,
    drawCards,
    drawTitleAndInfo,
    fmtDate,
    INK,
    lastY,
    loadLogo,
    M,
    resolveTheme,
    sectionTitle,
    stampAllPages,
    tableBase,
} from './reportPdfKit';
import { convertMinutesToTimeFormat, formatToTwoDecimalPlaces } from '../-services/helper';
import { BatchReportResponse, LearnersReportResponse } from '../-types/types';

/**
 * Branded PDF export for the slide-wise Learning Reports (Batch & Learner),
 * matching the Live Class report style (institute logo, theme colour, watermark).
 */

/** This file's own i18n namespace — passed explicitly via `{ ns: NAMESPACE }`
 *  so callers whose bound `t` defaults to a different namespace (the report
 *  screens that call these exporters) still resolve these keys correctly.
 *  Callers must include this namespace in their own `useTranslation([...])`
 *  array so it's loaded before this runs. */
const NAMESPACE = 'studyLibraryExportLearningPdf';

export interface LearningPdfMeta {
    instituteName: string;
    logoUrl: string | null;
    courseName: string;
    dateRange: string;
    learnerName?: string;
}

export interface LearningLeaderboardRow {
    rank: number;
    full_name: string;
    avg_concentration: number;
    daily_avg_time: number;
    total_time: number;
}

export interface LearningTimelineSlide {
    slide_title: string;
    module_name: string;
    chapter_name: string;
    subject_name: string;
    concentration_score: number;
    time_spent: string | number;
}

/**
 * The per-date slide breakdown shown under "Learning Timeline" on screen.
 * hideModule/hideChapter mirror the on-screen DEFAULT-column hiding so a
 * course with no real modules/chapters doesn't print a column of "DEFAULT".
 */
export interface LearningTimelinePdfInput {
    slides: Array<{ date: string; slide_details: LearningTimelineSlide[] }>;
    hideModule: boolean;
    hideChapter: boolean;
    moduleTerm: string;
    chapterTerm: string;
}

export async function exportBatchLearningPdf(
    meta: LearningPdfMeta,
    report: BatchReportResponse,
    leaderboard: LearningLeaderboardRow[],
    t: TFunction
) {
    const doc = createReportDoc();
    const logo = await loadLogo(meta.logoUrl);
    const theme = resolveTheme();
    const subtitle = t('subtitle', { ns: NAMESPACE });

    let y = drawTitleAndInfo(doc, t('batchReportTitle', { ns: NAMESPACE }), [
        { label: t('course', { ns: NAMESPACE }), value: meta.courseName },
        { label: t('period', { ns: NAMESPACE }), value: meta.dateRange },
    ]);

    y = drawCards(
        doc,
        theme,
        [
            {
                label: t('courseCompleted', { ns: NAMESPACE }),
                value: `${formatToTwoDecimalPlaces(report.percentage_course_completed)}%`,
            },
            {
                label: t('avgTimeSpent', { ns: NAMESPACE }),
                value: convertMinutesToTimeFormat(report.avg_time_spent_in_minutes ?? 0),
            },
            {
                label: t('avgConcentration', { ns: NAMESPACE }),
                value: `${formatToTwoDecimalPlaces(report.percentage_concentration_score)}%`,
            },
        ],
        y
    );

    if (leaderboard.length) {
        y = sectionTitle(doc, t('leaderboard', { ns: NAMESPACE }), y, theme);
        autoTable(doc, {
            ...tableBase(theme),
            startY: y,
            head: [
                [
                    t('rank', { ns: NAMESPACE }),
                    t('name', { ns: NAMESPACE }),
                    t('concentration', { ns: NAMESPACE }),
                    t('dailyAvgTime', { ns: NAMESPACE }),
                    t('totalTime', { ns: NAMESPACE }),
                ],
            ],
            columnStyles: {
                0: { halign: 'center', cellWidth: 16 },
                2: { halign: 'right' },
                3: { halign: 'right' },
                4: { halign: 'right' },
            },
            body: leaderboard.map((r) => [
                String(r.rank),
                r.full_name,
                `${formatToTwoDecimalPlaces(r.avg_concentration)}%`,
                convertMinutesToTimeFormat(r.daily_avg_time ?? 0),
                convertMinutesToTimeFormat(r.total_time ?? 0),
            ]),
        });
        y = lastY(doc) + 11;
    }

    y = sectionTitle(doc, t('dailyTimeSpent', { ns: NAMESPACE }), y, theme);
    autoTable(doc, {
        ...tableBase(theme),
        startY: y,
        head: [[t('date', { ns: NAMESPACE }), t('timeSpent', { ns: NAMESPACE })]],
        columnStyles: { 1: { halign: 'right' } },
        body: (report.daily_time_spent ?? []).map((d) => [
            fmtDate(d.activity_date),
            convertMinutesToTimeFormat(d.avg_daily_time_minutes ?? 0),
        ]),
    });

    stampAllPages(doc, meta.instituteName, logo, theme, subtitle);
    doc.save(`batch-learning-report-${dayjs().format('YYYYMMDD')}.pdf`);
}

export async function exportLearnerLearningPdf(
    meta: LearningPdfMeta,
    report: LearnersReportResponse,
    t: TFunction,
    timeline?: LearningTimelinePdfInput
) {
    const doc = createReportDoc();
    const logo = await loadLogo(meta.logoUrl);
    const theme = resolveTheme();
    const learner = report.learner_progress_report;
    const batch = report.batch_progress_report;
    const subtitle = t('subtitle', { ns: NAMESPACE });
    const batchLabel = t('batch', { ns: NAMESPACE });

    let y = drawTitleAndInfo(doc, t('learnerReportTitle', { ns: NAMESPACE }), [
        { label: t('learner', { ns: NAMESPACE }), value: meta.learnerName || '—' },
        { label: t('course', { ns: NAMESPACE }), value: meta.courseName },
        { label: t('period', { ns: NAMESPACE }), value: meta.dateRange },
    ]);

    y = drawCards(
        doc,
        theme,
        [
            {
                label: t('courseCompleted', { ns: NAMESPACE }),
                value: `${formatToTwoDecimalPlaces(learner.percentage_course_completed)}%`,
                sub: `${batchLabel} ${formatToTwoDecimalPlaces(batch.percentage_course_completed)}%`,
            },
            {
                label: t('avgTimeSpent', { ns: NAMESPACE }),
                value: convertMinutesToTimeFormat(learner.avg_time_spent_in_minutes ?? 0),
                sub: `${batchLabel} ${convertMinutesToTimeFormat(batch.avg_time_spent_in_minutes ?? 0)}`,
            },
            {
                label: t('avgConcentration', { ns: NAMESPACE }),
                value: `${formatToTwoDecimalPlaces(learner.percentage_concentration_score)}%`,
                sub: `${batchLabel} ${formatToTwoDecimalPlaces(batch.percentage_concentration_score)}%`,
            },
        ],
        y
    );

    // Merge daily time spent by date (learner vs batch).
    const byDate = new Map<string, { learner?: number; batch?: number }>();
    (learner.daily_time_spent ?? []).forEach((d) => {
        byDate.set(d.activity_date, {
            ...(byDate.get(d.activity_date) || {}),
            learner: d.avg_daily_time_minutes,
        });
    });
    (batch.daily_time_spent ?? []).forEach((d) => {
        byDate.set(d.activity_date, {
            ...(byDate.get(d.activity_date) || {}),
            batch: d.avg_daily_time_minutes,
        });
    });
    const dates = [...byDate.keys()].sort((a, b) => a.localeCompare(b));

    y = sectionTitle(doc, t('dailyTimeSpent', { ns: NAMESPACE }), y, theme);
    autoTable(doc, {
        ...tableBase(theme),
        startY: y,
        head: [
            [
                t('date', { ns: NAMESPACE }),
                t('learner', { ns: NAMESPACE }),
                t('batchAvg', { ns: NAMESPACE }),
            ],
        ],
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
        body: dates.map((date) => {
            const v = byDate.get(date) ?? {};
            return [
                fmtDate(date),
                convertMinutesToTimeFormat(v.learner ?? 0),
                convertMinutesToTimeFormat(v.batch ?? 0),
            ];
        }),
    });

    // Per-date slide breakdown — the "Learning Timeline" the report shows on screen.
    if (timeline?.slides?.length) {
        const pageH = doc.internal.pageSize.getHeight();
        y = lastY(doc) + 11;
        if (y > pageH - 40) {
            doc.addPage();
            y = 33;
        }
        y = sectionTitle(doc, t('learningTimeline', { ns: NAMESPACE }), y, theme);
        timeline.slides.forEach((day) => {
            if (y > pageH - 40) {
                doc.addPage();
                y = 33;
            }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(...INK);
            doc.text(t('dateLabel', { ns: NAMESPACE, date: fmtDate(day.date) }), M, y);

            const head = [
                t('studySlide', { ns: NAMESPACE }),
                ...(timeline.hideModule ? [] : [timeline.moduleTerm]),
                ...(timeline.hideChapter ? [] : [timeline.chapterTerm]),
                t('concentration', { ns: NAMESPACE }),
                t('timeSpent', { ns: NAMESPACE }),
            ];
            const concIdx = head.length - 2;
            const timeIdx = head.length - 1;
            autoTable(doc, {
                ...tableBase(theme),
                startY: y + 2,
                head: [head],
                columnStyles: {
                    [concIdx]: { halign: 'right', cellWidth: 26 },
                    [timeIdx]: { halign: 'right', cellWidth: 22 },
                },
                body: (day.slide_details ?? []).map((s) => {
                    const timeMinutes =
                        typeof s.time_spent === 'number'
                            ? s.time_spent
                            : parseFloat(String(s.time_spent)) || 0;
                    return [
                        s.slide_title,
                        ...(timeline.hideModule ? [] : [s.module_name]),
                        ...(timeline.hideChapter ? [] : [s.chapter_name]),
                        `${formatToTwoDecimalPlaces(s.concentration_score)} %`,
                        convertMinutesToTimeFormat(timeMinutes),
                    ];
                }),
            });
            y = lastY(doc) + 8;
        });
    }

    stampAllPages(doc, meta.instituteName, logo, theme, subtitle);
    doc.save(
        `learner-learning-report-${(meta.learnerName || 'learner').replace(/\s+/g, '-')}-${dayjs().format(
            'YYYYMMDD'
        )}.pdf`
    );
}
