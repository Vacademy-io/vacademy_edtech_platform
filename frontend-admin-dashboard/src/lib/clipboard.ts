/**
 * Copy text to the clipboard, with a fallback for the case the async Clipboard
 * API refuses.
 *
 * `navigator.clipboard.writeText` is gated on a *recent* user gesture in Safari
 * and in Firefox, so a "copy" that has to wait on a network round-trip first —
 * fetching a short link, say — can be rejected even though the user did click a
 * button. The hidden-textarea + `execCommand` path has no such window, so it
 * still works there.
 *
 * Returns whether the text made it to the clipboard; callers should surface a
 * failure rather than silently pretending it worked.
 */
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (!text) return false;

    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Fall through to the legacy path below.
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        // Keep it off-screen and non-focusable-looking, but still selectable —
        // `display: none` or `hidden` would make the selection (and the copy) fail.
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied;
    } catch {
        return false;
    }
};
