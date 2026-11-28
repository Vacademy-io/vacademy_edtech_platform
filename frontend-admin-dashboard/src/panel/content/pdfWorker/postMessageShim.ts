/**
 * pdf.js 3.11 calls `postMessage(message, null)` when there is nothing to
 * transfer (e.g. sendWithPromise("GetDocRequest", source, null), legacy
 * pdf.js:3609). Chrome 66-69 reject a null transfer list ("The provided value
 * cannot be converted to a sequence"); measured on panel_api28, the PDF never
 * opened. This wrapper drops a null/undefined transfer argument, which is what
 * newer Chrome does anyway. Used on the page (Worker / MessagePort) by
 * PanelPdfViewer and inside the worker by ./init.
 */
type PostMessage = (this: unknown, message: unknown, transfer?: unknown) => void;
type Patched = PostMessage & { __panelNullTransfer?: true };

export function patchNullTransfer(target: { postMessage?: unknown } | null | undefined): void {
    if (!target || typeof target.postMessage !== 'function') return;
    const original = target.postMessage as Patched;
    if (original.__panelNullTransfer) return;
    const patched: Patched = function postMessage(this: unknown, message, transfer) {
        if (transfer === null || transfer === undefined) {
            original.call(this, message);
            return;
        }
        original.call(this, message, transfer);
    };
    patched.__panelNullTransfer = true;
    target.postMessage = patched;
}
