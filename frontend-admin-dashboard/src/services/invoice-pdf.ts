/**
 * Shared helpers for working with an invoice's PDF: resolving its URL, fetching it,
 * downloading it under a meaningful filename, previewing it inline, and sharing it.
 *
 * These live here (not in a route-local service) because three separate surfaces need
 * them — the learner side-view invoice list, the sub-org analytics invoice list, and the
 * Create-Invoice success screen — and they were previously duplicated/inconsistent
 * (some call sites used a raw `window.open`, which saves the file under an opaque S3
 * key name instead of the invoice number).
 */

import { getInvoiceDownloadUrl } from '@/services/invoice-service';
import { BASE_URL } from '@/constants/urls';
import { TokenKey } from '@/constants/auth/tokens';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';

/** The subset of an invoice any of the list/summary shapes can supply. */
export interface InvoicePdfSource {
    id: string;
    invoice_number?: string;
    /** camelCase variant used by the sub-org InvoiceSummary shape. */
    invoiceNumber?: string;
    pdf_url?: string | null;
    pdfUrl?: string | null;
    pdf_file_id?: string | null;
    pdfFileId?: string | null;
}

function invoiceNumberOf(invoice: InvoicePdfSource): string {
    return invoice.invoice_number || invoice.invoiceNumber || invoice.id;
}

/**
 * Filename for a downloaded invoice PDF — named by invoice number so a folder of
 * downloads is actually identifiable (`Invoice-INV-20260709-0001.pdf`) rather than
 * carrying the storage key. Strips characters that are illegal in filenames on
 * Windows/macOS so the download can't be silently rejected.
 */
export function buildInvoiceFilename(invoice: InvoicePdfSource): string {
    const safe = invoiceNumberOf(invoice).replace(/[/\\?%*:|"<>]/g, '-');
    return `Invoice-${safe}.pdf`;
}


/**
 * Auth header for a PDF fetch, but only when the URL is our own API.
 *
 * An invoice with a stored file resolves to a storage URL, which is already presigned and
 * must be fetched clean — S3 rejects a presigned request that also carries an
 * Authorization header. An invoice with no stored file instead resolves to
 * `/v1/invoices/{id}/download`, which is authenticated and regenerates the PDF server-side;
 * fetching that one without a token returns 403, so the preview failed and the PDF was
 * never generated. The endpoint 302s on to storage, and the browser drops Authorization on
 * that cross-origin hop, so the token never reaches S3.
 */
function pdfAuthHeaders(url: string): Record<string, string> {
    if (!url.startsWith(BASE_URL)) return {};
    const token = getTokenFromCookie(TokenKey.accessToken);
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Best URL to fetch this invoice's PDF from. Prefers a directly-supplied `pdf_url`;
 * otherwise falls back to the canonical `/v1/invoices/{id}/download` endpoint, which
 * 302s to a freshly-presigned URL AND regenerates the PDF server-side when the stored
 * file id is missing — so this returns a usable URL even for invoices whose original
 * upload failed.
 */
export function resolveInvoicePdfUrl(invoice: InvoicePdfSource): string {
    return invoice.pdf_url || invoice.pdfUrl || getInvoiceDownloadUrl(invoice.id);
}

/**
 * Fetch the PDF and hand back an object URL suitable for an `<iframe src>`.
 *
 * Deliberately goes through a blob rather than pointing the iframe at the S3 URL
 * directly: if the stored object carries `Content-Disposition: attachment`, an iframe
 * pointed at it would trigger a *download* instead of rendering. A `blob:` URL of an
 * `application/pdf` blob always renders in the browser's built-in viewer.
 *
 * Caller owns the returned URL and must `URL.revokeObjectURL` it when done.
 * Throws if the PDF can't be fetched (e.g. CORS) so the caller can fall back to
 * opening it in a new tab.
 */
export async function fetchInvoicePdfObjectUrl(invoice: InvoicePdfSource): Promise<string> {
    const url = resolveInvoicePdfUrl(invoice);
    const resp = await fetch(url, { credentials: 'omit', headers: pdfAuthHeaders(url) });
    if (!resp.ok) throw new Error(`Invoice PDF fetch failed (${resp.status})`);
    const blob = await resp.blob();
    // Force the PDF media type — some storage backends serve octet-stream, which the
    // browser would offer to download rather than render.
    return URL.createObjectURL(
        blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
    );
}

/**
 * Download the invoice PDF under its invoice-number filename. Fetches as a blob so the
 * `download` attribute is honoured (a cross-origin `<a download>` is ignored by
 * browsers, which is why a plain anchor/`window.open` can't control the filename).
 * Falls back to opening in a new tab if the fetch is blocked.
 */
export async function downloadInvoicePdf(invoice: InvoicePdfSource): Promise<void> {
    const url = resolveInvoicePdfUrl(invoice);
    try {
        const objectUrl = await fetchInvoicePdfObjectUrl(invoice);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = buildInvoiceFilename(invoice);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

// ─── WhatsApp sharing ─────────────────────────────────────────────────────────

export interface InvoiceShareDetails {
    invoice: InvoicePdfSource;
    recipientName: string;
    /** Pre-formatted total, e.g. "₹8,260.00". */
    amountLabel: string;
    paymentLink?: string | null;
}

/** The message body shared alongside (or instead of) the PDF file. */
function buildShareMessage({
    invoice,
    recipientName,
    amountLabel,
    paymentLink,
    includePdfLink,
}: InvoiceShareDetails & { includePdfLink: boolean }): string {
    const lines = [
        `Hi ${recipientName}, your invoice ${invoiceNumberOf(invoice)} for ${amountLabel} is ready.`,
    ];
    if (paymentLink) lines.push(`Pay here: ${paymentLink}`);
    // Only append the PDF link when the file itself isn't being attached — otherwise the
    // recipient gets the document twice (once as a file, once as a link).
    if (includePdfLink) {
        const pdf = invoice.pdf_url || invoice.pdfUrl;
        if (pdf) lines.push(`Invoice PDF: ${pdf}`);
    }
    return lines.join('\n');
}

/**
 * Share an invoice to WhatsApp, attaching the actual PDF **file** when the browser
 * supports it.
 *
 * IMPORTANT CONSTRAINT: a `wa.me?text=` deep link can only carry text — WhatsApp's URL
 * scheme has no parameter for attaching a file. The only web mechanism that can hand a
 * real file to WhatsApp is the Web Share API (`navigator.share({ files })`), which is
 * available on mobile browsers and some desktop ones. So:
 *
 *  - Web Share API with file support → shares the real PDF + message (user picks WhatsApp).
 *  - Otherwise → opens WhatsApp with a message containing the payment link *and* a direct
 *    PDF link, which is the closest achievable behaviour.
 *
 * Returns which path was taken so the caller can tailor its toast.
 */
export async function shareInvoiceOnWhatsApp(
    details: InvoiceShareDetails
): Promise<'file' | 'link'> {
    // Try to attach the real PDF via the Web Share API.
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            const url = resolveInvoicePdfUrl(details.invoice);
            const resp = await fetch(url, { credentials: 'omit', headers: pdfAuthHeaders(url) });
            if (resp.ok) {
                const blob = await resp.blob();
                const file = new File([blob], buildInvoiceFilename(details.invoice), {
                    type: 'application/pdf',
                });
                // canShare({files}) is the only reliable capability probe; calling share()
                // with unsupported files throws on some browsers.
                if (navigator.canShare?.({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        text: buildShareMessage({ ...details, includePdfLink: false }),
                    });
                    return 'file';
                }
            }
        }
    } catch (err) {
        // AbortError = the user dismissed the share sheet; that's a deliberate cancel,
        // so don't silently fall back to opening WhatsApp behind their back.
        if (err instanceof DOMException && err.name === 'AbortError') return 'file';
        // Anything else (CORS, unsupported) → fall through to the link-based path.
    }

    const text = encodeURIComponent(buildShareMessage({ ...details, includePdfLink: true }));
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
    return 'link';
}
