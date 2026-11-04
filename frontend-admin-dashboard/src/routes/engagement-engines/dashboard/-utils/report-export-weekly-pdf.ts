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
    resolveTheme,
    sectionTitle,
    stampAllPages,
    tableBase,
} from '@/routes/study-library/reports/-utils/reportPdfKit';
import { buildWeeklyExportTables, weeklyPeriod, type WeeklyExportInput } from './diagnosis-export';
import { DASH, exportFileName } from './report-format';
import { formatPeriodDates } from './report-period';
import { rangeT } from './report-range-t';

const CARDS_PER_ROW = 4;
// A portrait page fits about this many readable table columns.
const MAX_COLUMNS = 8;
// Space needed below a heading before a new table may start on the same page (mm).
const MIN_ROOM = 45;
const FIRST_Y_ON_NEW_PAGE = 33;
// The kit stamps "Vacademy" when the institute name is empty; a blank keeps the page unbranded
// instead of showing another brand on an institute's report.
const NO_BRAND = ' ';

const clip = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The PDF's built-in font cannot draw the rupee sign, so money goes on the page with its code. */
const pdfText = (text: string) => text.replace(/₹\s*/g, 'INR ');

/**
 * Branded PDF of the weekly page: header and info band, the headline cards, the problems, the
 * stage statuses, then each weekly table. Charts are left out; the tables carry the same figures.
 * Laid out like the daily report's PDF (report-export-pdf.ts).
 */
export async function exportWeeklyPdf(input: WeeklyExportInput) {
    const { diagnosis, kpis, engineName } = input;
    const t = rangeT(input.t, true);
    const period = weeklyPeriod(diagnosis);
    const periodText = formatPeriodDates(period);
    const doc = createReportDoc();
    const theme = resolveTheme();
    const pageH = doc.internal.pageSize.getHeight();

    const instituteId = getCurrentInstituteId() ?? '';
    const details = instituteId
        ? await fetchInstituteDetailsById(instituteId).catch(() => null)
        : null;
    const logoUrl = await resolveInstituteLogoUrl(details?.institute_logo_file_id).catch(
        () => null
    );
    const logo = await loadLogo(logoUrl);

    let y = drawTitleAndInfo(
        doc,
        pdfText(t('diagnosis.export.titleWeekly', { period: periodText })),
        [
            { label: pdfText(t('export.engine')), value: pdfText(engineName) },
            {
                label: pdfText(t('export.periodDays', { count: diagnosis.days })),
                value: periodText,
            },
            { label: pdfText(t('export.timezone')), value: diagnosis.timezone || DASH },
        ]
    );

    const room = () => {
        if (y > pageH - MIN_ROOM) {
            doc.addPage();
            y = FIRST_Y_ON_NEW_PAGE;
        }
    };

    const addTable = (title: string, head: string[], body: string[][], numeric: boolean[]) => {
        room();
        y = sectionTitle(doc, pdfText(title), y, theme);
        const base = tableBase(theme);
        // Wider tables are split into column groups that each repeat the first column, so
        // headers don't break mid-word.
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
            y = lastY(doc) + (g < groups.length - 1 ? 4 : 11);
        });
    };

    // Headline cards, four to a row.
    for (let i = 0; i < kpis.length; i += CARDS_PER_ROW) {
        room();
        y = drawCards(
            doc,
            theme,
            kpis.slice(i, i + CARDS_PER_ROW).map((k) => ({
                label: pdfText(k.label),
                value: pdfText(k.value),
                // A card is a quarter of the page: longer notes run past its edge.
                sub: k.detail ? clip(pdfText(k.detail), 28) : undefined,
            })),
            y
        );
    }

    buildWeeklyExportTables({ diagnosis, view: input.view, t }).forEach((table) =>
        addTable(table.title, table.head, table.display, table.numeric)
    );

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
        pdfText(`${engineName} · ${periodText}`),
        pdfText(t('diagnosis.export.cornerLabel'))
    );
    doc.save(
        exportFileName(engineName, period, 'pdf', diagnosis.engineId).replace(
            /^engagement-report-/,
            'engagement-weekly-'
        )
    );
}
