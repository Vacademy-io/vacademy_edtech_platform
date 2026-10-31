import autoTable from 'jspdf-autotable';
import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import {
    BatchLiveSummary,
    LearnerLiveStats,
    formatDuration,
    parseEngagement,
} from './liveCompute';
import { LiveSessionRow } from '../-services/liveReportApi';
import {
    createReportDoc,
    drawCards,
    drawTitleAndInfo,
    fmtDate,
    lastY,
    loadLogo,
    resolveTheme,
    sectionTitle,
    stampAllPages,
    tableBase,
} from '../../../-utils/reportPdfKit';

/**
 * Live-class report export. Reuses the shared report PDF kit for all branded
 * chrome (theme colour, logo header + watermark, cards, tables, footer).
 *
 * These are plain export functions (not components/hooks), so they cannot
 * call useTranslation() themselves — per the i18n rollout convention, the
 * caller's `t` is threaded in as an optional parameter. Until a caller wires
 * itself up and passes its own `t`, this fallback resolves each call's
 * defaultValue string so behavior (and the English copy) stays unchanged.
 * Keys live under the `studyLibraryExportLivePdf` namespace.
 */

const fallbackT: TFunction = ((
    _key: string,
    defaultValue?: unknown,
    options?: unknown
) => {
    if (typeof defaultValue !== 'string') return String(_key);
    if (!options || typeof options !== 'object') return defaultValue;
    return defaultValue.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, name) => {
        const value = (options as Record<string, unknown>)[name];
        return value === undefined ? match : String(value);
    });
}) as unknown as TFunction;

export interface LivePdfMeta {
    instituteName: string;
    logoUrl: string | null;
    courseName: string;
    batchLabel: string;
    dateRange: string;
    generatedOn: string;
}

export async function exportBatchLivePdf(
    meta: LivePdfMeta,
    summary: BatchLiveSummary,
    t: TFunction = fallbackT
) {
    const CORNER = t('cornerLabel', 'LIVE CLASS REPORT');
    const SUBTITLE = t('subtitle', 'Attendance & Engagement Report');

    const doc = createReportDoc();
    const logo = await loadLogo(meta.logoUrl);
    const theme = resolveTheme();

    let y = drawTitleAndInfo(doc, t('batch.title', 'Batch Live Class Report'), [
        { label: t('fields.course', 'Course'), value: meta.courseName },
        { label: t('fields.batch', 'Batch'), value: meta.batchLabel || meta.courseName },
        { label: t('fields.period', 'Period'), value: meta.dateRange },
    ]);

    y = drawCards(doc, theme, [
        {
            label: t('batch.cards.avgAttendance', 'Avg Attendance'),
            value: `${summary.avgAttendancePct.toFixed(1)}%`,
            sub: t('batch.cards.learnersCount', '{{count}} learners', {
                count: summary.learnerCount,
            }),
        },
        {
            label: t('batch.cards.classesHeld', 'Classes Held'),
            value: `${summary.totalClassesHeld}`,
        },
        {
            label: t('batch.cards.avgDuration', 'Avg Duration'),
            value: formatDuration(summary.avgDurationMinutes),
            sub: t('batch.cards.perPresentLearner', 'per present learner'),
        },
        {
            label: t('batch.cards.avgEngagement', 'Avg Engagement'),
            value: `${summary.avgEngagementIndex}`,
            sub: t('batch.cards.participationPoints', 'participation points'),
        },
    ], y);

    y = sectionTitle(doc, t('batch.classWiseAttendance', 'Class-wise Attendance'), y, theme);
    autoTable(doc, {
        ...tableBase(theme),
        startY: y,
        head: [[
            t('tableHeaders.date', 'Date'),
            t('tableHeaders.class', 'Class'),
            t('tableHeaders.present', 'Present'),
            t('tableHeaders.absent', 'Absent'),
            t('tableHeaders.attendance', 'Attendance'),
            t('tableHeaders.avgDuration', 'Avg Duration'),
            t('tableHeaders.engagement', 'Engagement'),
        ]],
        columnStyles: {
            2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
            5: { halign: 'right' }, 6: { halign: 'right' },
        },
        body: summary.perClass.map((c) => [
            fmtDate(c.date),
            c.title,
            String(c.present),
            String(c.total - c.present),
            `${c.attendancePct.toFixed(0)}%`,
            formatDuration(c.avgDurationMinutes),
            String(c.avgEngagementIndex),
        ]),
    });

    y = sectionTitle(doc, t('leaderboard.title', 'Leaderboard'), lastY(doc) + 11, theme);
    autoTable(doc, {
        ...tableBase(theme),
        startY: y,
        head: [[
            t('tableHeaders.rank', 'Rank'),
            t('tableHeaders.name', 'Name'),
            t('tableHeaders.attendance', 'Attendance'),
            t('tableHeaders.classes', 'Classes'),
            t('tableHeaders.avgDuration', 'Avg Duration'),
            t('tableHeaders.engagement', 'Engagement'),
        ]],
        columnStyles: {
            0: { halign: 'center', cellWidth: 16 },
            2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
        },
        body: summary.leaderboard.map((r) => [
            String(r.rank),
            r.fullName,
            `${r.attendancePercentage.toFixed(1)}%`,
            `${r.attended}/${r.total}`,
            formatDuration(r.avgDurationMinutes),
            String(r.engagementIndex),
        ]),
    });

    stampAllPages(doc, meta.instituteName, logo, theme, SUBTITLE, CORNER);
    doc.save(`live-class-batch-report-${dayjs().format('YYYYMMDD')}.pdf`);
}

export async function exportLearnerLivePdf(
    meta: LivePdfMeta,
    learner: LearnerLiveStats,
    rows: LiveSessionRow[],
    batch: BatchLiveSummary,
    t: TFunction = fallbackT
) {
    const CORNER = t('cornerLabel', 'LIVE CLASS REPORT');
    const SUBTITLE = t('subtitle', 'Attendance & Engagement Report');

    const doc = createReportDoc();
    const logo = await loadLogo(meta.logoUrl);
    const theme = resolveTheme();

    let y = drawTitleAndInfo(doc, t('learner.title', 'Learner Live Class Report'), [
        { label: t('fields.learner', 'Learner'), value: learner.fullName },
        { label: t('fields.course', 'Course'), value: meta.courseName },
        { label: t('fields.period', 'Period'), value: meta.dateRange },
    ]);

    y = drawCards(doc, theme, [
        {
            label: t('fields.attendance', 'Attendance'),
            value: `${learner.attendancePercentage.toFixed(1)}%`,
            sub: t('learner.cards.batchPct', 'Batch {{pct}}%', {
                pct: batch.avgAttendancePct.toFixed(1),
            }),
        },
        {
            label: t('learner.cards.classesAttended', 'Classes Attended'),
            value: `${learner.attended}/${learner.total}`,
        },
        {
            label: t('batch.cards.avgDuration', 'Avg Duration'),
            value: formatDuration(learner.avgDurationMinutes),
            sub: t('learner.cards.batchDuration', 'Batch {{duration}}', {
                duration: formatDuration(batch.avgDurationMinutes),
            }),
        },
        {
            label: t('fields.engagement', 'Engagement'),
            value: `${learner.engagementIndex}`,
            sub: t('learner.cards.batchAvgPts', 'Batch avg {{points}} pts', {
                points: batch.avgEngagementIndex,
            }),
        },
    ], y);

    y = sectionTitle(doc, t('learner.classHistory', 'Class History'), y, theme);
    autoTable(doc, {
        ...tableBase(theme),
        startY: y,
        head: [[
            t('tableHeaders.date', 'Date'),
            t('tableHeaders.class', 'Class'),
            t('tableHeaders.status', 'Status'),
            t('tableHeaders.duration', 'Duration'),
            t('tableHeaders.talkTime', 'Talk Time'),
            t('tableHeaders.chats', 'Chats'),
            t('tableHeaders.polls', 'Polls'),
            t('tableHeaders.raiseHand', 'Raise Hand'),
        ]],
        columnStyles: {
            3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
            6: { halign: 'right' }, 7: { halign: 'right' },
        },
        body: [...rows]
            .sort((a, b) => (a.meetingDate ?? '').localeCompare(b.meetingDate ?? ''))
            .map((r) => {
                const e = parseEngagement(r.engagementData);
                return [
                    fmtDate(r.meetingDate),
                    r.title,
                    r.attendanceStatus === 'PRESENT'
                        ? t('status.present', 'Present')
                        : t('status.absent', 'Absent'),
                    formatDuration(r.durationMinutes),
                    e ? `${Math.round(e.talkTimeSeconds / 60)}m` : '—',
                    e ? String(e.chats) : '—',
                    e ? String(e.pollVotes) : '—',
                    e ? String(e.raiseHand) : '—',
                ];
            }),
    });

    stampAllPages(doc, meta.instituteName, logo, theme, SUBTITLE, CORNER);
    doc.save(`live-class-learner-${learner.fullName.replace(/\s+/g, '-')}-${dayjs().format('YYYYMMDD')}.pdf`);
}
