/**
 * "Result Sheet" PDF — the cohort-level document, one file for the whole assessment.
 *
 * Distinct from Export Reports (ZIP), which produces one report PDF per student. This is
 * the single ranked sheet a teacher prints and pins up: header, headline statistics, score
 * distribution, then every student in rank order.
 *
 * Built with jspdf + jspdf-autotable (both already dependencies) rather than by rendering
 * HTML to canvas, so the table paginates properly and the text stays selectable.
 */
import { jsPDF } from 'jspdf';
import { applyPlugin, type CellHookData, type UserOptions } from 'jspdf-autotable';

// Registered via the named `applyPlugin` rather than the package's default export.
// jspdf-autotable is CJS and sets `__esModule` at runtime with defineProperty, which
// bundlers cannot see statically — so `import autoTable from 'jspdf-autotable'` resolves
// to the module object, not the function, and calling it throws. The named export has no
// such ambiguity. Verified by generating this PDF in a real browser build.
applyPlugin(jsPDF);

type AutoTableDoc = jsPDF & {
    autoTable: (options: UserOptions) => void;
    lastAutoTable?: { finalY: number };
};

export interface ResultSheetRow {
    studentName: string;
    email: string;
    batch: string;
    /** Raw marks. Null when the attempt has not been graded. */
    score: number | null;
    /** Minutes spent, already rounded by the caller. Null when unknown. */
    durationMinutes: number | null;
    /** Submission clock time, or null when the system auto-closed the attempt. */
    submittedAt: string | null;
}

export interface ResultSheetMeta {
    instituteName: string;
    assessmentName: string;
    /** e.g. "Class 9 · Session 2026-27". Omitted from the PDF when empty. */
    subtitle?: string;
    /** e.g. "14 August 2026 · 18:00-20:00 IST". Omitted when empty. */
    scheduleLine?: string;
    totalMarks: number;
}

const NAVY = [30, 41, 59] as const;
const MUTED = [120, 132, 148] as const;
const RULE = [226, 232, 240] as const;

/** Marks out of `total` as a whole percentage; 0 when the paper is unmarked. */
const pct = (score: number, total: number) => (total > 0 ? Math.round((score / total) * 100) : 0);

/**
 * Competition ranking: equal scores share a rank and the next distinct score skips ahead
 * (1, 2, 3, 3, 5 …), matching how a printed result sheet reads. Ungraded attempts sort last.
 */
export const rankRows = (rows: ResultSheetRow[]): Array<ResultSheetRow & { rank: number }> => {
    const sorted = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    let lastScore: number | null = null;
    let lastRank = 0;
    return sorted.map((row, index) => {
        const rank = row.score !== null && row.score === lastScore ? lastRank : index + 1;
        lastScore = row.score;
        lastRank = rank;
        return { ...row, rank };
    });
};

/** Headline stats plus the four distribution bands used on the printed sheet. */
export const summarise = (rows: ResultSheetRow[], totalMarks: number) => {
    const graded = rows
        .filter((r): r is ResultSheetRow & { score: number } => r.score !== null)
        .sort((a, b) => a.score - b.score);

    if (graded.length === 0) {
        return { average: null, median: null, highest: null, highestName: '', lowest: null, bands: [] };
    }

    const mid = Math.floor(graded.length / 2);
    const median =
        graded.length % 2 === 0
            ? (graded[mid - 1]!.score + graded[mid]!.score) / 2
            : graded[mid]!.score;
    const top = graded[graded.length - 1]!;

    // Bands are proportional, so they read the same whether the paper is out of 75 or 20.
    const cut = (fraction: number) => Math.round(totalMarks * fraction);
    const bands = [
        { label: `${cut(0.8)} and above`, min: cut(0.8), max: Infinity },
        { label: `${cut(0.6)} – ${cut(0.8) - 1}`, min: cut(0.6), max: cut(0.8) - 1 },
        { label: `${cut(0.4)} – ${cut(0.6) - 1}`, min: cut(0.4), max: cut(0.6) - 1 },
        { label: `Below ${cut(0.4)}`, min: -Infinity, max: cut(0.4) - 1 },
    ].map((b) => ({
        ...b,
        count: graded.filter((r) => r.score >= b.min && r.score <= b.max).length,
    }));

    return {
        average: graded.reduce((sum, r) => sum + r.score, 0) / graded.length,
        median,
        highest: top.score,
        highestName: top.studentName,
        lowest: graded[0]!.score,
        bands,
    };
};

export const buildResultSheetPdf = (rows: ResultSheetRow[], meta: ResultSheetMeta): jsPDF => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const M = 40;
    let y = 48;

    // ─── Header ──────────────────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(194, 106, 26);
    doc.text(meta.instituteName.toUpperCase(), M, y);

    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(...MUTED);
    if (meta.scheduleLine) doc.text(meta.scheduleLine, pageW - M, y, { align: 'right' });

    y += 20;
    doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...NAVY);
    // The "N students appeared" note occupies the right-hand end of this line, so the
    // title only owns the space up to it. Without this a long assessment name overprints
    // that note and then runs off the page edge entirely.
    const appearedNote = `${rows.length} students appeared`;
    doc.setFontSize(9).setFont('helvetica', 'normal');
    const noteW = doc.getTextWidth(appearedNote);
    doc.setFont('helvetica', 'bold').setFontSize(17);
    const titleMaxW = pageW - M * 2 - noteW - 16;
    const titleLines = doc.splitTextToSize(`${meta.assessmentName} — Result Sheet`, titleMaxW);
    doc.setTextColor(...NAVY);
    doc.text(titleLines[0], M, y);

    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(...MUTED);
    doc.text(appearedNote, pageW - M, y, { align: 'right' });

    // A name too long for one line continues underneath rather than being clipped away.
    if (titleLines.length > 1) {
        y += 19;
        doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...NAVY);
        doc.text(titleLines[1], M, y);
    }

    if (meta.subtitle) {
        y += 15;
        doc.setFontSize(9).setTextColor(...MUTED);
        doc.text(meta.subtitle, M, y);
    }

    y += 12;
    doc.setDrawColor(...NAVY).setLineWidth(1.2).line(M, y, pageW - M, y);
    y += 20;

    // ─── Statistic tiles ─────────────────────────────────────────────────────
    const stats = summarise(rows, meta.totalMarks);
    const tiles: Array<[string, string, string]> = [
        ['AVERAGE', stats.average === null ? '—' : stats.average.toFixed(1),
            stats.average === null ? '' : `out of ${meta.totalMarks} · ${pct(stats.average, meta.totalMarks)}%`],
        ['MEDIAN', stats.median === null ? '—' : String(stats.median), `out of ${meta.totalMarks}`],
        ['HIGHEST', stats.highest === null ? '—' : String(stats.highest), stats.highestName],
        ['LOWEST', stats.lowest === null ? '—' : String(stats.lowest), `out of ${meta.totalMarks}`],
    ];
    const tileW = (pageW - M * 2 - 8 * (tiles.length - 1)) / tiles.length;
    tiles.forEach(([label, value, sub], i) => {
        const x = M + i * (tileW + 8);
        doc.setDrawColor(...RULE).setLineWidth(0.7).roundedRect(x, y, tileW, 58, 4, 4);
        doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED);
        doc.text(label, x + 10, y + 16);
        doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...NAVY);
        doc.text(value, x + 10, y + 38);
        if (sub) {
            doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED);
            doc.text(doc.splitTextToSize(sub, tileW - 20)[0] ?? '', x + 10, y + 50);
        }
    });
    y += 78;

    // ─── Score distribution ──────────────────────────────────────────────────
    if (stats.bands.length > 0) {
        doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...NAVY);
        doc.text('SCORE DISTRIBUTION', M, y);
        y += 12;

        const maxCount = Math.max(...stats.bands.map((b) => b.count), 1);
        const barX = M + 110;
        const barMaxW = pageW - M - barX - 30;
        stats.bands.forEach((band) => {
            doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
            doc.text(band.label, M, y + 7);
            doc.setFillColor(241, 245, 249).roundedRect(barX, y, barMaxW, 9, 2, 2, 'F');
            if (band.count > 0) {
                doc.setFillColor(59, 90, 138)
                    .roundedRect(barX, y, Math.max((band.count / maxCount) * barMaxW, 3), 9, 2, 2, 'F');
            }
            doc.setTextColor(...NAVY).text(String(band.count), pageW - M, y + 7, { align: 'right' });
            y += 15;
        });
        y += 10;
    }

    // ─── Ranked table ────────────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...NAVY);
    doc.text('INDIVIDUAL RESULTS — RANKED', M, y);
    y += 8;

    (doc as AutoTableDoc).autoTable({
        startY: y,
        margin: { left: M, right: M },
        // Keep a student's two-line cell (name over email, batch over group) intact
        // instead of splitting it across the page break.
        rowPageBreak: 'avoid',
        head: [['#', 'STUDENT', 'BATCH', 'SCORE', '%', 'TIME', 'SUB.']],
        body: rankRows(rows).map((r) => [
            String(r.rank),
            r.email ? `${r.studentName}\n${r.email}` : r.studentName,
            r.batch,
            r.score === null ? '—' : `${r.score} / ${meta.totalMarks}`,
            r.score === null ? '—' : `${pct(r.score, meta.totalMarks)}%`,
            r.durationMinutes === null ? '—' : `${r.durationMinutes} min`,
            r.submittedAt ?? 'auto',
        ]),
        theme: 'grid',
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [51, 65, 85], cellPadding: 4 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
            0: { cellWidth: 24, halign: 'center' },
            2: { cellWidth: 96 },
            3: { cellWidth: 56, halign: 'right', fontStyle: 'bold' },
            4: { cellWidth: 34, halign: 'right' },
            5: { cellWidth: 46, halign: 'right' },
            6: { cellWidth: 40, halign: 'right' },
        },
        styles: { lineColor: [226, 232, 240], lineWidth: 0.4 },
        didParseCell: (data: CellHookData) => {
            // The email line under each name is secondary information.
            if (data.section === 'body' && data.column.index === 1) {
                data.cell.styles.fontSize = 8;
            }
        },
    });

    // ─── Footnote ────────────────────────────────────────────────────────────
    const endY = (doc as AutoTableDoc).lastAutoTable?.finalY ?? y;
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...MUTED);
    doc.text(
        doc.splitTextToSize(
            '"Time" is the time spent on the attempt. "Sub." is the submission time, or "auto" where the attempt was closed by the system on expiry.',
            pageW - M * 2
        ),
        M,
        endY + 14
    );

    return doc;
};
