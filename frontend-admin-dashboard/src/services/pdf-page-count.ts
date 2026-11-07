import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

/**
 * How many pages a submitted answer sheet has, from its public URL.
 *
 * The AI copy-check is priced per page, so the confirm dialog needs the count
 * before the run starts. An image upload, an unreadable PDF or a network
 * failure all count as one page: the quote must never block the teacher, and
 * the backend bills from the page count the OCR actually processed anyway.
 */
export const countPdfPages = async (url: string): Promise<number> => {
    if (!url) return 1;
    try {
        const response = await fetch(url);
        const type = (response.headers.get('content-type') || '').toLowerCase();
        const buffer = await response.arrayBuffer();
        const looksLikePdf =
            type.includes('pdf') ||
            String.fromCharCode(...new Uint8Array(buffer.slice(0, 5))) === '%PDF-';
        if (!looksLikePdf) return 1;
        const pdf = await pdfjs.getDocument({ data: buffer }).promise;
        return Math.max(1, pdf.numPages);
    } catch {
        return 1;
    }
};
