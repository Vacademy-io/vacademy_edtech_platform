import { jsPDF } from 'jspdf';
import dayjs from 'dayjs';
import i18next from 'i18next';
import { getBase64FromUrl } from '@/components/common/export-offline/utils/utils';

/**
 * Shared, branded PDF building blocks used by every report export (live-class
 * and slide-wise learning reports). Provides the institute-themed chrome:
 * top accent bar, header band with logo, title + info panel, KPI cards,
 * accent-barred section headers, striped tables, and a "Page X of Y" footer.
 */

export type RGB = [number, number, number];

export const M = 14; // page margin (mm)
export const INK: RGB = [33, 37, 41];
export const MUTED: RGB = [120, 127, 137];
export const BORDER: RGB = [226, 229, 234];
export const PANEL: RGB = [247, 248, 250];
const DEFAULT_ACCENT: RGB = [237, 116, 36]; // brand fallback orange

export interface Theme {
    accent: RGB;
    tint: RGB;
}

export interface LoadedLogo {
    dataUrl: string;
    ratio: number; // width / height
}

// ---------------------------------------------------------------------------
// Theme (reads the live institute colour from CSS var --primary-500)
// ---------------------------------------------------------------------------

function hslToRgb(h: number, s: number, l: number): RGB {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const m = l - c / 2;
    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
    ];
}

export function resolveTheme(): Theme {
    try {
        if (typeof document !== 'undefined') {
            const raw = getComputedStyle(document.documentElement)
                .getPropertyValue('--primary-500')
                .trim();
            const m = raw.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
            if (m) {
                const h = parseFloat(m[1] ?? '0');
                const s = parseFloat(m[2] ?? '0') / 100;
                const l = parseFloat(m[3] ?? '0') / 100;
                return {
                    accent: hslToRgb(h, s, l),
                    tint: hslToRgb(h, Math.min(s, 0.7), 0.95),
                };
            }
        }
    } catch {
        // ignore and use the fallback
    }
    return { accent: DEFAULT_ACCENT, tint: [253, 240, 230] };
}

// ---------------------------------------------------------------------------
// Logo loading (CORS-safe: fetch → data URL → canvas → PNG)
// ---------------------------------------------------------------------------

function imageToPngDataUrl(src: string, useCors: boolean): Promise<LoadedLogo | null> {
    return new Promise((resolve) => {
        const img = new Image();
        if (useCors) img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                if (!img.naturalWidth || !img.naturalHeight) return resolve(null);
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(null);
                ctx.drawImage(img, 0, 0);
                resolve({
                    dataUrl: canvas.toDataURL('image/png'),
                    ratio: img.naturalWidth / img.naturalHeight,
                });
            } catch {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
    });
}

async function fetchToDataUrl(url: string): Promise<string | null> {
    try {
        const resp = await fetch(url, { mode: 'cors', cache: 'no-cache' });
        if (!resp.ok) return null;
        return await blobToDataUrl(await resp.blob());
    } catch {
        return null;
    }
}

export async function loadLogo(url: string | null): Promise<LoadedLogo | null> {
    if (!url) return null;
    if (url.startsWith('data:')) return imageToPngDataUrl(url, false);

    let dataUrl = await fetchToDataUrl(url);
    if (!dataUrl || !dataUrl.startsWith('data:')) {
        try {
            const b64 = (await getBase64FromUrl(url)) as string | undefined;
            if (b64 && b64.startsWith('data:')) dataUrl = b64;
        } catch {
            /* ignore */
        }
    }
    if (dataUrl && dataUrl.startsWith('data:')) {
        const normalized = await imageToPngDataUrl(dataUrl, false);
        if (normalized) return normalized;
    }
    return imageToPngDataUrl(url, true);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

export function createReportDoc(): jsPDF {
    return new jsPDF({ unit: 'mm', format: 'a4' });
}

export function fmtDate(d: string | null | undefined): string {
    if (!d) return '—';
    const parsed = dayjs(d);
    return parsed.isValid() ? parsed.format('DD MMM YYYY') : '—';
}

/** Top accent bar + header band + faint watermark + footer, on every page. */
export function stampAllPages(
    doc: jsPDF,
    instituteName: string,
    logo: LoadedLogo | null,
    theme: Theme,
    subtitle: string,
    cornerLabel = i18next.t('studyLibraryReportPdfKit:cornerLabel.default')
) {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const gs = (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState;
    const pageCount = doc.getNumberOfPages();
    const name = instituteName || 'Vacademy';

    for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        const cx = pageW / 2;
        const cy = pageH / 2;

        doc.setFillColor(...theme.accent);
        doc.rect(0, 0, pageW, 3, 'F');

        if (logo) {
            doc.saveGraphicsState();
            doc.setGState(new gs({ opacity: 0.05 }));
            const wmW = 95;
            const wmH = wmW / logo.ratio;
            doc.addImage(logo.dataUrl, 'PNG', cx - wmW / 2, cy - wmH / 2 - 6, wmW, wmH);
            doc.restoreGraphicsState();
        }
        doc.saveGraphicsState();
        doc.setGState(new gs({ opacity: 0.04 }));
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(52);
        doc.setTextColor(140, 140, 140);
        doc.text(name, cx, cy + 52, { align: 'center', angle: 30 });
        doc.restoreGraphicsState();

        let textX = M;
        if (logo) {
            const h = 12;
            const w = Math.min(h * logo.ratio, 36);
            doc.addImage(logo.dataUrl, 'PNG', M, 8, w, h);
            textX = M + w + 4;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(...INK);
        doc.text(name, textX, 15);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...MUTED);
        doc.text(subtitle, textX, 20.5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...theme.accent);
        doc.setCharSpace(0.5);
        doc.text(cornerLabel, pageW - M, 15, { align: 'right' });
        doc.setCharSpace(0);

        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.3);
        doc.line(M, 27, pageW - M, 27);

        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.2);
        doc.line(M, pageH - 12, pageW - M, pageH - 12);
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(name, M, pageH - 7);
        doc.text(
            i18next.t('studyLibraryReportPdfKit:footer.pageOf', { p, pageCount }),
            pageW - M,
            pageH - 7,
            { align: 'right' }
        );
    }
}

/** Title + tinted info band with key/value cells. Returns the next y. */
export function drawTitleAndInfo(
    doc: jsPDF,
    title: string,
    pairs: { label: string; value: string }[]
): number {
    const pageW = doc.internal.pageSize.getWidth();
    const contentW = pageW - 2 * M;
    let y = 38;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...INK);
    doc.text(title, M, y);
    y += 5;

    const h = 16;
    doc.setFillColor(...PANEL);
    doc.roundedRect(M, y, contentW, h, 1.5, 1.5, 'F');
    const cellW = contentW / pairs.length;
    pairs.forEach((p, i) => {
        const x = M + i * cellW + 6;
        if (i > 0) {
            doc.setDrawColor(...BORDER);
            doc.setLineWidth(0.2);
            doc.line(M + i * cellW, y + 3, M + i * cellW, y + h - 3);
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...MUTED);
        doc.setCharSpace(0.4);
        doc.text(p.label.toUpperCase(), x, y + 6.5);
        doc.setCharSpace(0);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(...INK);
        const line = doc.splitTextToSize(p.value || '—', cellW - 9)[0] ?? p.value;
        doc.text(line, x, y + 12);
    });

    return y + h + 8;
}

/** KPI cards with a left accent tab. Returns the next y. */
export function drawCards(
    doc: jsPDF,
    theme: Theme,
    cards: { label: string; value: string; sub?: string }[],
    y: number
): number {
    const pageW = doc.internal.pageSize.getWidth();
    const contentW = pageW - 2 * M;
    const gap = 4;
    const cardW = (contentW - gap * (cards.length - 1)) / cards.length;
    const cardH = 23;

    cards.forEach((c, i) => {
        const x = M + i * (cardW + gap);
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.3);
        doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');
        doc.setFillColor(...theme.accent);
        doc.rect(x, y + 1, 1.6, cardH - 2, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...MUTED);
        doc.setCharSpace(0.3);
        doc.text(c.label.toUpperCase(), x + 6, y + 7);
        doc.setCharSpace(0);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(...INK);
        doc.text(c.value, x + 6, y + 15);

        if (c.sub) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...MUTED);
            doc.text(c.sub, x + 6, y + 20);
        }
    });

    return y + cardH + 9;
}

/** Accent-barred section heading with an underline. Returns the next y. */
export function sectionTitle(doc: jsPDF, text: string, y: number, theme: Theme): number {
    const pageW = doc.internal.pageSize.getWidth();
    doc.setFillColor(...theme.accent);
    doc.rect(M, y - 3.4, 1.6, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.setCharSpace(0.3);
    doc.text(text.toUpperCase(), M + 4, y + 0.6);
    doc.setCharSpace(0);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.line(M, y + 3.5, pageW - M, y + 3.5);
    return y + 9;
}

export function tableBase(theme: Theme) {
    return {
        theme: 'striped' as const,
        margin: { top: 33, bottom: 18, left: M, right: M },
        headStyles: {
            fillColor: theme.accent,
            textColor: 255,
            fontStyle: 'bold' as const,
            fontSize: 8,
            cellPadding: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
        },
        bodyStyles: { fontSize: 8, textColor: INK, cellPadding: 2.2 },
        alternateRowStyles: { fillColor: [248, 249, 251] as RGB },
        styles: { lineColor: [237, 239, 242] as RGB, lineWidth: 0.1 },
    };
}

export function lastY(doc: jsPDF): number {
    return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}
