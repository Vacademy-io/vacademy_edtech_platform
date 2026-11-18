import { getInstituteId } from '@/constants/helper';
import type { LabelLanguage, LabelRow, LabelTemplate, PrintLabel, TextPair } from './inventory-types';
import { LABEL_LANGUAGES, LABEL_TEMPLATES } from './inventory-types';

/**
 * Printing labels from the browser (owner decision 2026-11-18: labels carry
 * Hindi names, which the browser shapes) and opening the server's challan
 * PDF. The pure parts are unit-tested: the label sheet layout, the start
 * position on a used A4 sheet, the 500-label cap, which name goes where, and
 * the scoped `@page` rule of one print.
 */

export const MAX_LABELS_PER_PRINT = 500;
export const A4_COLUMNS = 5;
export const A4_ROWS = 13;
export const A4_POSITIONS = A4_COLUMNS * A4_ROWS;

export interface LabelChoice {
    template: LabelTemplate;
    language: LabelLanguage;
    /** A4 only: the first free label on a used sheet (1..65). */
    startPosition: number;
}

export const DEFAULT_LABEL_CHOICE: LabelChoice = { template: 'STICKER_50X25', language: 'both', startPosition: 1 };

export type LabelPrintProblem = 'nothing' | 'tooMany' | 'startPosition';

/** Labels a selection prints: a quantity row repeats its label. */
export const labelCount = (rows: Pick<LabelRow, 'quantity'>[]): number =>
    rows.reduce((sum, row) => sum + Math.max(1, row.quantity), 0);

export const validStartPosition = (value: number): boolean =>
    Number.isInteger(value) && value >= 1 && value <= A4_POSITIONS;

/** What stops a print before anything is asked of the server (null = ready). */
export function printProblem(count: number, choice: LabelChoice): LabelPrintProblem | null {
    if (count <= 0) return 'nothing';
    if (count > MAX_LABELS_PER_PRINT) return 'tooMany';
    if (choice.template === 'A4_65' && !validStartPosition(choice.startPosition)) return 'startPosition';
    return null;
}

/** Every label as many times as its `copies`, in the server's order. */
export const expandCopies = (labels: PrintLabel[]): PrintLabel[] =>
    labels.flatMap((label) => Array.from({ length: Math.max(1, label.copies) }, () => label));

/**
 * A4 sheets of 65 (5 across, 13 down): the first `start - 1` places of the
 * first sheet stay empty (already used), then the labels; one array per sheet.
 */
export function a4Sheets(labels: PrintLabel[], start: number): (PrintLabel | null)[][] {
    const skip = validStartPosition(start) ? start - 1 : 0;
    const cells: (PrintLabel | null)[] = [...Array.from({ length: skip }, () => null), ...expandCopies(labels)];
    const sheets: (PrintLabel | null)[][] = [];
    for (let i = 0; i < cells.length; i += A4_POSITIONS) sheets.push(cells.slice(i, i + A4_POSITIONS));
    return sheets;
}

/** The name lines of a label: the main line and, for "both", English small below. */
export function labelText(pair: TextPair, language: LabelLanguage): { main: string; small: string | null } {
    const hi = pair.hi?.trim() || null;
    const en = pair.en?.trim() || null;
    if (language === 'en') return { main: en ?? hi ?? '', small: null };
    if (language === 'hi') return { main: hi ?? en ?? '', small: null };
    return { main: hi ?? en ?? '', small: hi && en ? en : null };
}

/** The page rule of one print: a sticker page of 50 × 25 mm, or A4; never a browser margin. */
export const pageRule = (template: LabelTemplate): string =>
    template === 'A4_65' ? '@page { size: 210mm 297mm; margin: 0; }' : '@page { size: 50mm 25mm; margin: 0; }';

export const LABEL_PRINTING_CLASS = 'inv-label-printing';
const PAGE_STYLE_ID = 'inv-label-page';
const PRINT_CLEANUP_MS = 60_000;

/**
 * Prints the label portal (as the counter prints its receipt): the body class
 * and the `@page` rule exist only for this print, so a packing slip or a
 * counter bill printed later keeps its own page. Resolves after the print
 * dialog closes (`afterprint`, or a fallback timer on browsers without it).
 */
export function printLabels(template: LabelTemplate, win: Window = window): Promise<void> {
    return new Promise((resolve) => {
        const doc = win.document;
        doc.getElementById(PAGE_STYLE_ID)?.remove();
        const style = doc.createElement('style');
        style.id = PAGE_STYLE_ID;
        style.textContent = pageRule(template);
        doc.head.appendChild(style);
        doc.body.classList.add(LABEL_PRINTING_CLASS);
        let done = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => {
            if (done) return;
            done = true;
            doc.body.classList.remove(LABEL_PRINTING_CLASS);
            style.remove();
            win.removeEventListener('afterprint', cleanup);
            if (timer) clearTimeout(timer);
            resolve();
        };
        win.addEventListener('afterprint', cleanup);
        try {
            win.print();
        } finally {
            timer = setTimeout(cleanup, PRINT_CLEANUP_MS);
        }
    });
}

const PREFS = () => `commerce.inventory.labels.${getInstituteId() ?? 'none'}`;

/** The last label size and language chosen at this institute on this device. */
export function readLabelChoice(): LabelChoice {
    try {
        const raw = globalThis.localStorage?.getItem(PREFS());
        const parsed = raw ? (JSON.parse(raw) as Partial<LabelChoice>) : {};
        return {
            template: (LABEL_TEMPLATES as readonly string[]).includes(parsed.template ?? '')
                ? (parsed.template as LabelTemplate)
                : DEFAULT_LABEL_CHOICE.template,
            language: (LABEL_LANGUAGES as readonly string[]).includes(parsed.language ?? '')
                ? (parsed.language as LabelLanguage)
                : DEFAULT_LABEL_CHOICE.language,
            startPosition: 1,
        };
    } catch {
        return DEFAULT_LABEL_CHOICE;
    }
}

export function rememberLabelChoice(choice: LabelChoice): void {
    try {
        globalThis.localStorage?.setItem(PREFS(), JSON.stringify({ template: choice.template, language: choice.language }));
    } catch {
        // Blocked storage: the choice is asked again next time.
    }
}

const REVOKE_AFTER_MS = 60_000;

/** Saves a file through a temporary link (the CSV export, and a PDF when no tab could open). */
export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/**
 * Opens a PDF the server draws (the delivery challan), for the person to
 * print from the browser's PDF viewer. MUST be called straight from the click
 * handler, before any `await`: the empty tab is opened synchronously (popup
 * blockers allow a tab opened by a click), then the PDF is fetched and the tab
 * is pointed at it. When no tab could open, the file is downloaded instead. A
 * failed fetch closes the empty tab and rethrows for the screen to show.
 */
export async function openPdf(
    fetcher: () => Promise<Blob>,
    fileName: string,
    win: Pick<Window, 'open'> = window
): Promise<'opened' | 'downloaded'> {
    let tab: Window | null = null;
    try {
        tab = win.open('', '_blank');
    } catch {
        tab = null;
    }
    let blob: Blob;
    try {
        blob = await fetcher();
    } catch (error) {
        try {
            tab?.close();
        } catch {
            // Already closed.
        }
        throw error;
    }
    const pdf = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
    if (tab && !tab.closed) {
        const url = URL.createObjectURL(pdf);
        tab.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
        return 'opened';
    }
    downloadBlob(pdf, fileName);
    return 'downloaded';
}

/** A file name from a number: `/` and other unsafe characters become `-`. */
export const safeFileName = (text: string): string => text.replace(/[^A-Za-z0-9._-]+/g, '-');
