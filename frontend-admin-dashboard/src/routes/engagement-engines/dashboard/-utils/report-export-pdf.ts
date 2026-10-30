import autoTable from 'jspdf-autotable';
import i18next from 'i18next';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { fetchInstituteDetailsById } from '@/services/student-list-section/getInstituteDetails';
import { resolveInstituteLogoUrl } from '@/routes/study-library/reports/-components/live/-utils/instituteLogo';
import {
    createReportDoc,
    drawCards,
    drawTitleAndInfo,
    lastY,
    loadLogo,
    M,
    MUTED,
    resolveTheme,
    sectionTitle,
    stampAllPages,
    tableBase,
} from '@/routes/study-library/reports/-utils/reportPdfKit';
import { failedSectionNames, partFailed } from './report-errors';
import { buildFunnelSteps, deliveryPartial, emailRepliesUntracked } from './report-funnel';
import { DASH, exportFileName, formatCredits, formatDay, formatNumber } from './report-format';
import { buildExportTables } from './report-tables';
import type { ReportExportInput } from './report-export';

const CARDS_PER_ROW = 4;
// A portrait page fits about this many readable table columns.
const MAX_COLUMNS = 8;
// Space needed below a heading before a new table may start on the same page (mm).
const MIN_ROOM = 45;
const FIRST_Y_ON_NEW_PAGE = 33;
// Space kept clear at the foot of a page (mm), as the table margin does, and a note's line height.
const BOTTOM_MARGIN = 18;
const NOTE_LINE_HEIGHT = 3.8;
// The kit stamps "Vacademy" when the institute name is empty; a blank keeps the page unbranded
// instead of showing another brand on an institute's report.
const NO_BRAND = ' ';

const clip = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The PDF's built-in font cannot draw the rupee sign (it prints as garbage), so money goes
 * on the page with its currency code: "₹0.86" becomes "INR 0.86".
 */
const pdfText = (text: string) => text.replace(/₹\s*/g, 'INR ');

/**
 * Branded PDF of the report: header and info band, the eight headline cards, warnings, the
 * funnel and 7-day trend as small tables, then every table and stat block. Charts are left
 * out; the tables carry the same figures.
 */
export async function exportReportPdf({ data, view, engineName, t }: ReportExportInput) {
    const doc = createReportDoc();
    const theme = resolveTheme();
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const instituteId = getCurrentInstituteId() ?? '';
    const details = instituteId
        ? await fetchInstituteDetailsById(instituteId).catch(() => null)
        : null;
    const logoUrl = await resolveInstituteLogoUrl(details?.institute_logo_file_id).catch(
        () => null
    );
    const logo = await loadLogo(logoUrl);

    let y = drawTitleAndInfo(doc, pdfText(t('export.pdfTitle')), [
        { label: pdfText(t('export.engine')), value: pdfText(engineName) },
        { label: pdfText(t('export.date')), value: formatDay(data.date) },
        { label: pdfText(t('export.timezone')), value: data.timezone || DASH },
    ]);

    const room = () => {
        if (y > pageH - MIN_ROOM) {
            doc.addPage();
            y = FIRST_Y_ON_NEW_PAGE;
        }
    };

    /** Small grey text under a table or at the end, wrapped to the page and carried over pages. */
    const addNote = (text: string) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        const lines: string[] = doc.splitTextToSize(pdfText(text), pageW - 2 * M);
        lines.forEach((line) => {
            if (y > pageH - BOTTOM_MARGIN) {
                doc.addPage();
                y = FIRST_Y_ON_NEW_PAGE;
            }
            doc.text(line, M, y);
            y += NOTE_LINE_HEIGHT;
        });
    };

    const addTable = (
        title: string,
        head: string[],
        body: string[][],
        numeric: boolean[],
        notes: string[] = []
    ) => {
        room();
        y = sectionTitle(doc, pdfText(title), y, theme);
        const base = tableBase(theme);
        // Wider tables (a list with the Lead Agent columns) are split into column groups that
        // each repeat the first column, so headers don't break mid-word.
        const groups: number[][] = [];
        for (let start = 1; start < Math.max(head.length, 2); start += MAX_COLUMNS - 1) {
            const rest = Array.from(
                { length: Math.min(MAX_COLUMNS - 1, head.length - start) },
                (_, i) => start + i
            );
            groups.push([0, ...rest]);
        }
        groups.forEach((cols, g) => {
            if (g > 0) room();
            const columnStyles: Record<number, { halign: 'right' }> = {};
            cols.forEach((col, i) => {
                if (numeric[col]) columnStyles[i] = { halign: 'right' };
            });
            autoTable(doc, {
                ...base,
                startY: y,
                head: [cols.map((col) => pdfText(head[col] ?? ''))],
                body: body.map((row) => cols.map((col) => pdfText(row[col] ?? ''))),
                columnStyles,
            });
            y = lastY(doc) + (g < groups.length - 1 ? 4 : notes.length > 0 ? 4 : 11);
        });
        if (notes.length > 0) {
            notes.forEach(addNote);
            y += 7;
        }
    };

    // Headline cards, four to a row.
    for (let i = 0; i < view.kpis.length; i += CARDS_PER_ROW) {
        room();
        y = drawCards(
            doc,
            theme,
            view.kpis.slice(i, i + CARDS_PER_ROW).map((k) => ({
                label: pdfText(k.label),
                value: pdfText(k.value),
                // A card is a quarter of the page: longer notes run past its edge.
                sub: k.detail ? clip(pdfText(k.detail), 28) : undefined,
            })),
            y
        );
    }

    if (view.banners.length > 0) {
        addTable(
            t('export.health'),
            [t('export.severity.title'), t('export.warning')],
            view.banners.map((b) => [t(`export.severity.${b.severity}`), `${b.title}. ${b.text}`]),
            [false, false]
        );
    }

    if (data.funnel.length > 0 && !partFailed(data.errors, 'funnel')) {
        addTable(
            t('funnel.title'),
            [t('export.stage'), t('export.people'), t('export.changeFromPrevious')],
            // Delivered is left out of the comparison when some channels give no receipts.
            buildFunnelSteps(data, t).map((s) => [
                s.label,
                s.untracked
                    ? t('notTracked')
                    : s.partial
                      ? t('funnel.partialCaption', { value: formatNumber(s.count) })
                      : formatNumber(s.count),
                s.dropOff === null ? DASH : `${-s.dropOff}%`,
            ]),
            [false, true, true],
            [
                ...(deliveryPartial(data) ? [t('funnel.deliveredNote')] : []),
                ...(emailRepliesUntracked(data) ? [t('email.repliesNote')] : []),
            ]
        );
    }

    if (data.trend.length > 0 && !partFailed(data.errors, 'trend')) {
        addTable(
            t('trend.title'),
            [
                t('export.date'),
                t('trend.series.sent'),
                t('trend.series.replies'),
                t('trend.series.demosBooked'),
                t('trend.series.credits'),
            ],
            data.trend.map((p) => [
                formatDay(p.date),
                formatNumber(p.sent),
                formatNumber(p.replies),
                formatNumber(p.demosBooked),
                formatCredits(p.credits),
            ]),
            [false, true, true, true, true]
        );
    }

    buildExportTables(view.model, data, t).forEach((table) =>
        addTable(table.title, table.head, table.display, table.numeric)
    );

    if (Object.keys(data.errors).length > 0) {
        room();
        addNote(`${t('export.failedSections')}: ${failedSectionNames(data.errors, t)}`);
    }

    // The kit's footer text lives in its own namespace; make sure it is loaded.
    try {
        await i18next.loadNamespaces('studyLibraryReportPdfKit');
    } catch {
        /* the footer falls back to its key */
    }
    stampAllPages(
        doc,
        details?.institute_name || NO_BRAND,
        logo,
        theme,
        pdfText(`${engineName} · ${formatDay(data.date)}`),
        pdfText(t('export.cornerLabel'))
    );
    doc.save(exportFileName(engineName, data.date, 'pdf', data.engineId));
}
