/**
 * The open conversation is carried in the URL as `?phone=919811586839`, so a refresh, a bookmark
 * or a link pasted to a colleague re-opens the same chat rather than the empty "Select a
 * conversation" pane.
 */

/** Digits with an optional leading +, the shape every channel_id in notification_log has. */
const PHONE = /^\+?\d{5,20}$/;

export interface InboxSearch {
    phone?: string;
}

/**
 * Read `?phone=` off the URL, keeping it only when it looks like a phone number — a hand-edited or
 * truncated URL then opens the inbox empty instead of sending junk to the messages endpoint.
 */
export function parseInboxSearch(search: Record<string, unknown>): InboxSearch {
    const raw = typeof search.phone === 'string' ? search.phone.trim() : '';
    return PHONE.test(raw) ? { phone: raw } : {};
}
