import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getPublicUrl } from '@/services/upload_file';
import type { ScanFileKind } from '../-services/scan-station-services';
import { localFile } from './local-files';

/**
 * A small picture of one scanned page: from the file on this computer when the
 * clerk added it in this tab, else from media (images by URL, PDF pages drawn
 * with pdfjs). At most four are fetched or drawn at once; results are cached
 * for the life of the tab.
 */

const PDF_WORKER_SRC = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
const MAX_CONCURRENT = 4;
/** Long edge of a drawn PDF thumbnail, in pixels. */
const THUMB_EDGE_PX = 360;

let running = 0;
const waiting: (() => void)[] = [];

const withSlot = async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
        return await task();
    } finally {
        running -= 1;
        waiting.shift()?.();
    }
};

const urls = new Map<string, Promise<string>>();
const docs = new Map<string, Promise<PDFDocumentProxy>>();
const thumbs = new Map<string, Promise<string>>();

const mediaUrl = (fileId: string): Promise<string> => {
    let p = urls.get(fileId);
    if (!p) {
        p = getPublicUrl(fileId).then((url) => {
            if (!url) throw new Error('no url');
            return url;
        });
        p.catch(() => urls.delete(fileId));
        urls.set(fileId, p);
    }
    return p;
};

const pdfDoc = (fileId: string): Promise<PDFDocumentProxy> => {
    let p = docs.get(fileId);
    if (!p) {
        p = (async () => {
            const local = localFile(fileId);
            const bytes = local
                ? await local.arrayBuffer()
                : await fetch(await mediaUrl(fileId)).then((r) => {
                      if (!r.ok) throw new Error(`${r.status}`);
                      return r.arrayBuffer();
                  });
            pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
            return pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        })();
        p.catch(() => docs.delete(fileId));
        docs.set(fileId, p);
    }
    return p;
};

const drawPdfPage = async (fileId: string, pageIndex: number): Promise<string> => {
    const doc = await pdfDoc(fileId);
    const page = await doc.getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
        scale: THUMB_EDGE_PX / Math.max(base.width, base.height),
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.8)
    );
    if (!blob) throw new Error('no thumbnail');
    return URL.createObjectURL(blob);
};

export const thumbUrl = (
    fileId: string,
    kind: ScanFileKind,
    pageIndex: number
): Promise<string> => {
    const key = `${fileId}:${pageIndex}`;
    let p = thumbs.get(key);
    if (!p) {
        p = withSlot(async () => {
            if (kind === 'PDF') return drawPdfPage(fileId, pageIndex);
            const local = localFile(fileId);
            return local ? URL.createObjectURL(local) : mediaUrl(fileId);
        });
        p.catch(() => thumbs.delete(key));
        thumbs.set(key, p);
    }
    return p;
};
