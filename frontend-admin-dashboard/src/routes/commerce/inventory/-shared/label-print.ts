import { getInstituteId } from '@/constants/helper';
import type {
    LabelLanguage,
    LabelPrintData,
    LabelRequestLine,
    LabelRow,
    LabelTemplate,
    PrintLabel,
    ReceiptLine,
    TextPair,
    ToReplaceRow,
} from './inventory-types';
import { LABEL_LANGUAGES, LABEL_TEMPLATES } from './inventory-types';

/**
 * Printing labels from the browser (owner decision 2026-11-18: labels carry
 * Hindi names, which the browser shapes) and opening the server's challan
 * PDF. The pure parts are unit-tested: the label sheet layout, the start
 * position on a used A4 sheet, printing more than 500 labels in rounds of
 * 500, which name goes where, and the scoped `@page` rule of one print.
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

export type LabelPrintProblem = 'nothing' | 'startPosition';

/** Most lines and rows the server takes in one `POST /labels/requests`. */
export const MAX_REQUEST_LINES = 100;
export const MAX_REQUEST_ROWS = 500;
/** Most ids the server takes in one `POST /labels/mark-printed`. */
export const MAX_MARK_IDS = 200;

/** A list in pieces of at most `size`, in order. */
export function chunks<T>(list: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += Math.max(1, size)) out.push(list.slice(i, i + Math.max(1, size)));
    return out;
}

/** Every request id that was drawn, once each, in the server's order (what "Yes, mark printed" marks). */
export const drawnRequestIds = (data: Pick<LabelPrintData, 'labels'>): string[] =>
    Array.from(new Set(data.labels.map((l) => l.request_id).filter((id): id is string => !!id)));

/** One `POST /labels/mark-printed`: ids, and the drawn labels of each row drawn in part. */
export interface MarkPrintedBatch {
    request_ids: string[];
    printed_copies?: Record<string, number>;
}

/**
 * What "Yes, mark printed" sends, in batches of at most `size` ids: every
 * drawn row; a row the print drew in part (it is in `left_out`) says how many
 * labels were drawn, so the server keeps the rest waiting for the next round.
 */
export function markPrintedBatches(data: Pick<LabelPrintData, 'labels' | 'left_out'>, size = MAX_MARK_IDS): MarkPrintedBatch[] {
    const partly = new Set(data.left_out.map((l) => l.request_id));
    const drawnCopies = new Map<string, number>();
    data.labels.forEach((l) => {
        if (l.request_id && partly.has(l.request_id)) {
            drawnCopies.set(l.request_id, (drawnCopies.get(l.request_id) ?? 0) + Math.max(1, l.copies));
        }
    });
    return chunks(drawnRequestIds(data), size).map((ids) => {
        const copies = ids.filter((id) => drawnCopies.has(id));
        return copies.length
            ? { request_ids: ids, printed_copies: Object.fromEntries(copies.map((id) => [id, drawnCopies.get(id) as number])) }
            : { request_ids: ids };
    });
}

/** Most labels the server queues for one receipt line; a counted line of more units gets this many. */
export const MAX_RECEIPT_LINE_LABELS = 10_000;

/**
 * Receipt lines whose labels were not all queued: a counted (not measured,
 * not one-of-a-kind) line of more than 10,000 units, with how many units got
 * no label. The screen says so; Reprint queues more.
 */
export function labelsNotQueued(
    lines: readonly Pick<ReceiptLine, 'sku' | 'product_name' | 'stock_mode' | 'qty_scale' | 'qty_received'>[]
): { item: string; units: number }[] {
    return lines
        .filter(
            (l) =>
                (l.stock_mode ?? '').toUpperCase() !== 'PIECE' && (l.qty_scale ?? 1) <= 1 && l.qty_received > MAX_RECEIPT_LINE_LABELS
        )
        .map((l) => ({ item: l.sku ?? l.product_name ?? '—', units: l.qty_received - MAX_RECEIPT_LINE_LABELS }));
}

/** The next free label of an A4 sheet after `drawn` labels from `start` (1..65): where the next round starts. */
export const nextStartPosition = (start: number, drawn: number): number =>
    ((((validStartPosition(start) ? start : 1) - 1 + Math.max(0, drawn)) % A4_POSITIONS) + A4_POSITIONS) % A4_POSITIONS + 1;

/**
 * What a queue row shows as its quantity: the labels it was queued with, and
 * how many of them are printed while it prints in rounds (null otherwise).
 */
export function labelQuantity(
    row: Pick<LabelRow, 'quantity' | 'original_quantity' | 'printed_quantity' | 'status'>
): { total: number; printed: number | null } {
    const total = Math.max(row.quantity, row.original_quantity);
    const printed = row.status !== 'PRINTED' && row.printed_quantity > 0 && row.printed_quantity < total ? row.printed_quantity : null;
    return { total, printed };
}

/** How many prints of at most 500 labels a number of labels takes. */
export const printRounds = (count: number): number => Math.max(1, Math.ceil(count / MAX_LABELS_PER_PRINT));

/** Waiting rows that can print now (the item has a price) and the ones that wait for one. */
export function splitByPrice<T extends Pick<LabelRow, 'has_price'>>(rows: readonly T[]): { priced: T[]; unpriced: T[] } {
    return { priced: rows.filter((r) => r.has_price), unpriced: rows.filter((r) => !r.has_price) };
}

export interface ReplacePlan {
    /** Request bodies' lines, each batch within the server's 100 lines / 500 rows. */
    batches: LabelRequestLine[][];
    /** Items without a price: not queued (a manager sets the price first). */
    unpriced: ToReplaceRow[];
    /** Items whose label count was cut to the cap. */
    capped: ToReplaceRow[];
}

/**
 * "Tags to replace → Queue labels" (L9): one label per piece of a one-of-a-kind
 * item (the server queues one row per piece here), one per roll of a measured
 * item, one per unit of a counted item (capped by the server, with a warning);
 * items without a price are left out and listed. Batches keep within the
 * server's limits, so a long list never fails as a whole.
 */
export function planReplaceLabels(rows: readonly ToReplaceRow[]): ReplacePlan {
    const unpriced = rows.filter((r) => !r.has_price);
    const capped = rows.filter((r) => r.has_price && r.capped);
    const batches: LabelRequestLine[][] = [];
    let batch: LabelRequestLine[] = [];
    let batchRows = 0;
    rows.forEach((r) => {
        if (!r.has_price || r.labels < 1) return;
        const piece = (r.stock_mode ?? '').toUpperCase() === 'PIECE';
        const measured = r.qty_scale > 1;
        // A piece item becomes one server row per piece; any other line is one row.
        const rowsOf = piece ? Math.min(r.labels, MAX_REQUEST_ROWS) : 1;
        if (batch.length >= MAX_REQUEST_LINES || (batch.length > 0 && batchRows + rowsOf > MAX_REQUEST_ROWS)) {
            batches.push(batch);
            batch = [];
            batchRows = 0;
        }
        batch.push(
            piece
                ? { package_session_id: r.package_session_id, quantity: 1 }
                : {
                      package_session_id: r.package_session_id,
                      quantity: measured ? Math.min(r.labels, MAX_REQUEST_LINES) : Math.min(r.labels, MAX_LABELS_PER_PRINT),
                  }
        );
        batchRows += rowsOf;
    });
    if (batch.length) batches.push(batch);
    return { batches, unpriced, capped };
}

/** Labels a selection prints: a quantity row repeats its label. */
export const labelCount = (rows: Pick<LabelRow, 'quantity'>[]): number =>
    rows.reduce((sum, row) => sum + Math.max(1, row.quantity), 0);

export const validStartPosition = (value: number): boolean =>
    Number.isInteger(value) && value >= 1 && value <= A4_POSITIONS;

/**
 * What stops a print before anything is asked of the server (null = ready).
 * More than 500 labels is not a stop: the server draws 500 and the rest
 * print in the next rounds.
 */
export function printProblem(count: number, choice: LabelChoice): LabelPrintProblem | null {
    if (count <= 0) return 'nothing';
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

/** The language of a label's fixed words (MRP, incl. of all taxes): English only for an English label. */
export const labelWordsLanguage = (language: LabelLanguage): 'en' | 'hi' => (language === 'en' ? 'en' : 'hi');

/** Unit signs moved to the shared helper (WP-44); re-exported so label importers do not change. */
export { perUnit, UNIT_SIGNS, unitSign } from '@/routes/commerce/-shared/units';

/**
 * What the QR holds. On the A4 sheet the QR is 10.5 mm: a long shop link
 * (about 40+ characters) makes modules too small for a 203/300 dpi printer,
 * so it holds the bare code there (the till and pack station read both).
 */
export const A4_QR_MAX_LINK = 40;
export const labelQrValue = (label: Pick<PrintLabel, 'qr_value' | 'code'>, a4: boolean): string =>
    a4 && label.qr_value.length > A4_QR_MAX_LINK ? label.code : label.qr_value;

/** The line under the barcode: the scan code, then the SKU. */
export const codeLine = (label: Pick<PrintLabel, 'code' | 'sku'>): string =>
    label.sku ? `${label.code} · ${label.sku}` : label.code;

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
let endActivePrint: (() => void) | null = null;

/**
 * Ends the label print now (the print screen closed before `afterprint`
 * came): its body class and its own `@page` rule go, so a packing slip or
 * counter bill printed next keeps its page. A later print's rule is never
 * touched by an earlier one.
 */
export function endLabelPrint(): void {
    endActivePrint?.();
}

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
            // Only this print's own state: a newer print keeps its class and rule.
            if (endActivePrint === cleanup) {
                endActivePrint = null;
                doc.body.classList.remove(LABEL_PRINTING_CLASS);
            }
            style.remove();
            win.removeEventListener('afterprint', cleanup);
            if (timer) clearTimeout(timer);
            resolve();
        };
        endActivePrint = cleanup;
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
