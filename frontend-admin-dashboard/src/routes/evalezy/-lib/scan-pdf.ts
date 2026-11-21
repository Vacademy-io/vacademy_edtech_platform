import { PDFDocument } from 'pdf-lib';
import type { EvalezyScanQuality } from '@/types/assessment-settings';

/**
 * Long edge of a scanned page and its JPEG quality. The AI reads a page at
 * ~2400 px, so STANDARD keeps that much detail and nothing more (about
 * 0.5-0.8 MB a page); HIGH is for small or faint handwriting.
 */
export const SCAN_SIZE: Record<EvalezyScanQuality, { longEdge: number; quality: number }> = {
    STANDARD: { longEdge: 2400, quality: 0.8 },
    HIGH: { longEdge: 3200, quality: 0.9 },
};

/** PDF page width in points (A4); the height follows the photo. */
const PAGE_WIDTH_PT = 595;

export interface ScanPage {
    id: string;
    /** Resized JPEG, the bytes that go into the PDF. */
    blob: Blob;
    /** Object URL of `blob` for the thumbnail; revoke when the page is dropped. */
    url: string;
    width: number;
    height: number;
}

/** The list with one item moved a place earlier (-1) or later (+1); unchanged at either end. */
export const movePage = <T>(items: T[], index: number, delta: -1 | 1): T[] => {
    const target = index + delta;
    if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
    const next = items.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as T);
    return next;
};

let pageSeq = 0;
const nextId = () => `p${Date.now().toString(36)}${(pageSeq++).toString(36)}`;

const canvasToJpeg = (canvas: HTMLCanvasElement, quality: number) =>
    new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('could not encode the page'))),
            'image/jpeg',
            quality
        )
    );

/**
 * One photo or camera frame → a page: upright (EXIF orientation applied),
 * scaled down to the quality's long edge, re-encoded as JPEG.
 */
export const toScanPage = async (
    source: Blob | HTMLCanvasElement,
    scanQuality: EvalezyScanQuality
): Promise<ScanPage> => {
    const { longEdge, quality } = SCAN_SIZE[scanQuality];
    const bitmap =
        source instanceof Blob
            ? await createImageBitmap(source, { imageOrientation: 'from-image' })
            : source;
    try {
        const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        // White first: a transparent PNG would otherwise turn black in the JPEG.
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
        const blob = await canvasToJpeg(canvas, quality);
        return { id: nextId(), blob, url: URL.createObjectURL(blob), width, height };
    } finally {
        if ('close' in bitmap) bitmap.close();
    }
};

/** The pages of one student's copy, in order, as one PDF (what the AI check opens). */
export const buildCopyPdf = async (
    pages: { bytes: Uint8Array | ArrayBuffer; width: number; height: number }[]
): Promise<Uint8Array> => {
    if (pages.length === 0) throw new Error('a copy needs at least one page');
    const pdf = await PDFDocument.create();
    for (const page of pages) {
        const image = await pdf.embedJpg(page.bytes);
        const height = (PAGE_WIDTH_PT * page.height) / page.width;
        pdf.addPage([PAGE_WIDTH_PT, height]).drawImage(image, {
            x: 0,
            y: 0,
            width: PAGE_WIDTH_PT,
            height,
        });
    }
    return pdf.save();
};

export const scanPagesToPdfFile = async (pages: ScanPage[], fileName: string): Promise<File> => {
    const bytes = await buildCopyPdf(
        await Promise.all(
            pages.map(async (p) => ({
                bytes: new Uint8Array(await p.blob.arrayBuffer()),
                width: p.width,
                height: p.height,
            }))
        )
    );
    // pdf-lib's output sits on a plain ArrayBuffer (never shared), which BlobPart needs.
    return new File([bytes as Uint8Array<ArrayBuffer>], fileName, { type: 'application/pdf' });
};
