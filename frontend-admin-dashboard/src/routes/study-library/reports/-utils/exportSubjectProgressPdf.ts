import autoTable from 'jspdf-autotable';
import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import {
    createReportDoc,
    drawCards,
    drawTitleAndInfo,
    lastY,
    loadLogo,
    resolveTheme,
    sectionTitle,
    stampAllPages,
    tableBase,
} from './reportPdfKit';
import { convertMinutesToTimeFormat, formatToTwoDecimalPlaces } from '../-services/helper';
import { SubjectProgressResponse } from '../-types/types';

/**
 * Branded client-side PDF for the "Learning Progress" (subject/module-wise) report —
 * same institute chrome (logo, theme colour, watermark, footer) as the other report
 * exports. Two variants: 'learner' (per-learner, learner vs batch columns) and
 * 'batch' (batch-level, batch columns only).
 *
 * Courses shallower than the full Subject → Module structure come back with the
 * literal "DEFAULT" placeholder for the missing level(s). A DEFAULT subject renders
 * under a plain "Module-wise Progress" heading instead of "Subject: DEFAULT", and a
 * table whose modules are all DEFAULT drops the Module column entirely.
 */

export interface SubjectProgressPdfMeta {
    instituteName: string;
    logoUrl: string | null;
    learnerName?: string;
    courseName: string;
    sessionName: string;
    levelName: string;
    // Institute terminology (naming settings) for labels/headings.
    courseTerm: string;
    sessionTerm: string;
    levelTerm: string;
    moduleTerm: string;
    subjectTerm: string;
    batchTerm: string;
    // 'learner' (default) shows learner + batch columns; 'batch' shows batch-only.
    variant?: 'learner' | 'batch';
}

const isDefaultLevel = (value: string | null | undefined) =>
    (value ?? '').trim().toUpperCase() === 'DEFAULT';

export async function exportSubjectProgressPdf(
    meta: SubjectProgressPdfMeta,
    data: SubjectProgressResponse,
    t: TFunction
) {
    const isBatch = meta.variant === 'batch';
    const doc = createReportDoc();
    const logo = await loadLogo(meta.logoUrl);
    const theme = resolveTheme();
    const pageH = doc.internal.pageSize.getHeight();

    const title = isBatch
        ? t('pdf.batchSubjectWiseProgress', {
              batchTerm: meta.batchTerm,
              subjectTerm: meta.subjectTerm,
          })
        : t('pdf.learnerProgressReport');
    let y = drawTitleAndInfo(doc, title, [
        ...(isBatch ? [] : [{ label: t('pdf.learnerLabel'), value: meta.learnerName || '—' }]),
        { label: meta.courseTerm, value: meta.courseName || '—' },
        { label: meta.sessionTerm, value: meta.sessionName || '—' },
        { label: meta.levelTerm, value: meta.levelName || '—' },
    ]);

    // Drop the Module column when every module (across every subject) is the
    // "DEFAULT" placeholder — mirrors the on-screen DEFAULT-column hiding.
    const allModules = data.flatMap((s) => s.modules ?? []);
    const hideModuleColumn =
        allModules.length > 0 && allModules.every((m) => isDefaultLevel(m.module_name));

    // Overall completion = mean over subjects of (mean over that subject's modules).
    const subjectStats = data
        .map((subject) => {
            const modules = subject.modules ?? [];
            const n = modules.length;
            if (n === 0) return null;
            const learner =
                modules.reduce((sum, m) => sum + (m.module_completion_percentage ?? 0), 0) / n;
            const batch =
                modules.reduce(
                    (sum, m) => sum + (m.module_completion_percentage_by_batch ?? 0),
                    0
                ) / n;
            return { learner, batch };
        })
        .filter((s): s is { learner: number; batch: number } => s !== null);

    const overallCompletion = subjectStats.length
        ? subjectStats.reduce((sum, s) => sum + s.learner, 0) / subjectStats.length
        : 0;
    const overallBatch = subjectStats.length
        ? subjectStats.reduce((sum, s) => sum + s.batch, 0) / subjectStats.length
        : 0;
    const totalModules = data.reduce((sum, s) => sum + (s.modules?.length ?? 0), 0);

    y = drawCards(
        doc,
        theme,
        isBatch
            ? [
                  {
                      label: t('pdf.termCompleted', { term: meta.courseTerm }),
                      value: `${formatToTwoDecimalPlaces(overallCompletion)}%`,
                  },
                  {
                      label: t('pdf.termsTracked', { term: meta.moduleTerm }),
                      value: String(totalModules),
                  },
              ]
            : [
                  {
                      label: t('pdf.termCompleted', { term: meta.courseTerm }),
                      value: `${formatToTwoDecimalPlaces(overallCompletion)}%`,
                      sub: `${meta.batchTerm} ${formatToTwoDecimalPlaces(overallBatch)}%`,
                  },
                  {
                      label: t('pdf.termCompleted', { term: meta.batchTerm }),
                      value: `${formatToTwoDecimalPlaces(overallBatch)}%`,
                  },
                  {
                      label: t('pdf.termsTracked', { term: meta.moduleTerm }),
                      value: String(totalModules),
                  },
              ],
        y
    );

    data.forEach((subject) => {
        const modules = subject.modules ?? [];
        if (modules.length === 0) return;

        if (y > pageH - 45) {
            doc.addPage();
            y = 33;
        }

        const heading = isDefaultLevel(subject.subject_name)
            ? t('pdf.termWiseProgress', { term: meta.moduleTerm })
            : t('pdf.termColonName', { term: meta.subjectTerm, name: subject.subject_name });
        y = sectionTitle(doc, heading, y, theme);

        const head = isBatch
            ? [...(hideModuleColumn ? [] : [meta.moduleTerm]), t('pdf.completed'), t('pdf.dailyTimeAvg')]
            : [
                  ...(hideModuleColumn ? [] : [meta.moduleTerm]),
                  t('pdf.completed'),
                  t('pdf.termCompleted', { term: meta.batchTerm }),
                  t('pdf.dailyTimeAvg'),
                  t('pdf.termDailyTimeAvg', { term: meta.batchTerm }),
              ];

        // Right-align every column except the leading Module label (when shown).
        const firstNumericIdx = hideModuleColumn ? 0 : 1;
        const columnStyles: Record<number, { halign: 'right' }> = {};
        for (let i = firstNumericIdx; i < head.length; i++) {
            columnStyles[i] = { halign: 'right' };
        }

        autoTable(doc, {
            ...tableBase(theme),
            startY: y,
            head: [head],
            columnStyles,
            body: modules.map((m) =>
                isBatch
                    ? [
                          ...(hideModuleColumn ? [] : [m.module_name]),
                          `${formatToTwoDecimalPlaces(m.module_completion_percentage)}%`,
                          convertMinutesToTimeFormat(m.avg_time_spent_minutes ?? 0),
                      ]
                    : [
                          ...(hideModuleColumn ? [] : [m.module_name]),
                          `${formatToTwoDecimalPlaces(m.module_completion_percentage)}%`,
                          `${formatToTwoDecimalPlaces(m.module_completion_percentage_by_batch)}%`,
                          convertMinutesToTimeFormat(m.avg_time_spent_minutes ?? 0),
                          convertMinutesToTimeFormat(m.avg_time_spent_minutes_by_batch ?? 0),
                      ]
            ),
        });
        y = lastY(doc) + 11;
    });

    stampAllPages(
        doc,
        meta.instituteName,
        logo,
        theme,
        isBatch
            ? t('pdf.termWiseProgressReport', { term: meta.subjectTerm })
            : t('pdf.learningProgressReport')
    );

    const safeName = isBatch
        ? (meta.courseName || 'batch').replace(/\s+/g, '-')
        : (meta.learnerName || 'learner').replace(/\s+/g, '-');
    doc.save(
        `${isBatch ? 'batch-subject-progress' : 'learning-progress'}-${safeName}-${dayjs().format(
            'YYYYMMDD'
        )}.pdf`
    );
}
