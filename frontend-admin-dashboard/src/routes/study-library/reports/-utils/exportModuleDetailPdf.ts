import autoTable from 'jspdf-autotable';
import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import {
    createReportDoc,
    drawTitleAndInfo,
    INK,
    lastY,
    loadLogo,
    M,
    MUTED,
    resolveTheme,
    sectionTitle,
    stampAllPages,
    tableBase,
} from './reportPdfKit';
import { convertMinutesToTimeFormat, formatToTwoDecimalPlaces } from '../-services/helper';
import { ChapterReport } from '../-types/types';

/**
 * Branded client-side PDF for the "Module Details" drill-down (per-chapter slide
 * breakdown). Same institute chrome as the other report exports; replaces the
 * old server-rendered HTML→PDF. DEFAULT subjects and redundant term prefixes are
 * suppressed the same way the on-screen dialog does.
 */

/** This file's own i18n namespace — passed explicitly via `{ ns: NAMESPACE }`
 *  so callers whose bound `t` defaults to a different namespace still resolve
 *  these keys correctly. Callers must include this namespace in their own
 *  `useTranslation([...])` array so it's loaded before this runs. */
const NAMESPACE = 'studyLibraryExportModuleDetailPdf';
export interface ModuleDetailPdfMeta {
    instituteName: string;
    logoUrl: string | null;
    learnerName?: string;
    courseName: string;
    sessionName: string;
    levelName: string;
    subjectName: string;
    moduleName: string;
    courseTerm: string;
    sessionTerm: string;
    levelTerm: string;
    subjectTerm: string;
    moduleTerm: string;
    chapterTerm: string;
    batchTerm: string;
}

const isDefaultLevel = (value: string | null | undefined) =>
    (value ?? '').trim().toUpperCase() === 'DEFAULT';

const nameHasTermPrefix = (name: string, term: string) =>
    (name ?? '').trim().toLowerCase().startsWith(term.trim().toLowerCase());

export async function exportModuleDetailPdf(
    meta: ModuleDetailPdfMeta,
    chapters: ChapterReport,
    t: TFunction
) {
    const doc = createReportDoc();
    const logo = await loadLogo(meta.logoUrl);
    const theme = resolveTheme();
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const contentW = pageW - 2 * M;

    let y = drawTitleAndInfo(
        doc,
        t('detailsReportTitle', { ns: NAMESPACE, term: meta.moduleTerm }),
        [
            ...(meta.learnerName
                ? [{ label: t('learner', { ns: NAMESPACE }), value: meta.learnerName }]
                : []),
            { label: meta.courseTerm, value: meta.courseName || '—' },
            { label: meta.sessionTerm, value: meta.sessionName || '—' },
            { label: meta.levelTerm, value: meta.levelName || '—' },
        ]
    );

    // Module (and non-DEFAULT subject) as a prominent, wrapping heading.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    const moduleLine = nameHasTermPrefix(meta.moduleName, meta.moduleTerm)
        ? meta.moduleName
        : `${meta.moduleTerm}: ${meta.moduleName}`;
    const moduleWrapped = doc.splitTextToSize(moduleLine, contentW) as string[];
    doc.text(moduleWrapped, M, y);
    y += moduleWrapped.length * 5.2;
    if (!isDefaultLevel(meta.subjectName)) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...MUTED);
        doc.text(
            t('termColonName', { ns: NAMESPACE, term: meta.subjectTerm, name: meta.subjectName }),
            M,
            y + 3
        );
        y += 6;
    }
    y += 4;

    chapters.forEach((chapter) => {
        if (y > pageH - 45) {
            doc.addPage();
            y = 33;
        }
        const heading = nameHasTermPrefix(chapter.chapter_name, meta.chapterTerm)
            ? chapter.chapter_name
            : t('termColonName', { ns: NAMESPACE, term: meta.chapterTerm, name: chapter.chapter_name });
        y = sectionTitle(doc, heading, y, theme);
        autoTable(doc, {
            ...tableBase(theme),
            startY: y,
            head: [
                [
                    t('studySlide', { ns: NAMESPACE }),
                    t('type', { ns: NAMESPACE }),
                    t('concentration', { ns: NAMESPACE }),
                    t('batchConcentrationAvg', { ns: NAMESPACE, batchTerm: meta.batchTerm }),
                    t('timeSpent', { ns: NAMESPACE }),
                    t('lastActive', { ns: NAMESPACE }),
                ],
            ],
            columnStyles: {
                0: { cellWidth: 42 },
                1: { cellWidth: 22 },
                2: { halign: 'right', cellWidth: 26 },
                3: { halign: 'right', cellWidth: 30 },
                4: { halign: 'right', cellWidth: 22 },
                5: { cellWidth: 32 },
            },
            body: (chapter.slides ?? []).map((s) => [
                s.slide_title,
                s.slide_source_type,
                `${formatToTwoDecimalPlaces(s.avg_concentration_score)} %`,
                `${formatToTwoDecimalPlaces(
                    s.avg_concentration_score_by_batch ?? s.avg_concentration_score
                )} %`,
                convertMinutesToTimeFormat(s.avg_time_spent ?? 0),
                s.last_active_date || t('notAvailable', { ns: NAMESPACE }),
            ]),
        });
        y = lastY(doc) + 10;
    });

    stampAllPages(
        doc,
        meta.instituteName,
        logo,
        theme,
        t('detailsReportTitle', { ns: NAMESPACE, term: meta.moduleTerm })
    );
    const safe = (meta.learnerName || 'learner').replace(/\s+/g, '-');
    doc.save(`module-details-${safe}-${dayjs().format('YYYYMMDD')}.pdf`);
}
