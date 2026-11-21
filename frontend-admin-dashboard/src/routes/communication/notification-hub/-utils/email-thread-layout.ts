/**
 * Pure layout rules for the Gmail-style email thread: which messages start open, how a long
 * thread folds, what the title is, which files a message lists.
 */
import type { EmailAttachment, EmailMessage } from '../-services/email-inbox-api';
import { isSystemMessage } from './email-text';

/** Threads longer than this fold their middle into "N older messages", as Gmail does. */
export const FOLD_AFTER = 4;

export function messageKey(msg?: EmailMessage): string | undefined {
    return msg ? msg.id || msg.timestamp : undefined;
}

export type ThreadRow =
    | { kind: 'message'; key: string; msg: EmailMessage }
    | { kind: 'fold'; count: number; afterKey: string };

/**
 * Gmail folds a long thread: the first message, a "N older messages" divider, then the last
 * two. Any message the reader opened stays visible (splitting the fold around it).
 */
export function foldRows(
    messages: EmailMessage[],
    expanded: Set<string>,
    unfolded: boolean
): ThreadRow[] {
    const keyed = messages.map((msg, i) => ({ msg, key: messageKey(msg) ?? String(i) }));
    if (unfolded || keyed.length <= FOLD_AFTER) {
        return keyed.map(({ msg, key }) => ({ kind: 'message', key, msg }));
    }
    const last = keyed.length - 1;
    const visible = (i: number) => i === 0 || i >= last - 1 || expanded.has(keyed[i]!.key);
    const rows: ThreadRow[] = [];
    let hidden = 0;
    keyed.forEach(({ msg, key }, i) => {
        if (visible(i)) {
            if (hidden > 0) {
                rows.push({ kind: 'fold', count: hidden, afterKey: key });
                hidden = 0;
            }
            rows.push({ kind: 'message', key, msg });
        } else {
            hidden++;
        }
    });
    return rows;
}

/** Keys opened by default: the newest message and the newest one a person sent us. */
export function defaultOpenKeys(messages: EmailMessage[]): string[] {
    const keys: string[] = [];
    const last = messageKey(messages[messages.length - 1]);
    if (last) keys.push(last);
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m && m.direction === 'INCOMING' && !isSystemMessage(m)) {
            const key = messageKey(m);
            if (key && key !== last) keys.push(key);
            break;
        }
    }
    return keys;
}

/**
 * The thread's title: the subject of the newest email a person wrote (else our newest), with
 * any "Re:/Fwd:" chain stripped, as Gmail shows it.
 */
export function threadTitle(messages: EmailMessage[]): string {
    const pick = (match: (m: EmailMessage) => boolean) => {
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m && match(m) && m.subject?.trim()) return m.subject.trim();
        }
        return '';
    };
    const subject =
        pick((m) => m.direction === 'INCOMING' && !isSystemMessage(m)) || pick(() => true);
    return subject.replace(/^((re|fwd?|aw|wg)\s*:\s*)+/i, '');
}

/**
 * Files to list under a message: its real attachments, plus inline images only when there is
 * no HTML body to show them in.
 */
export function visibleAttachments(msg: EmailMessage): EmailAttachment[] {
    const all = msg.attachments ?? [];
    return msg.hasHtml ? all.filter((a) => !a.inline) : all;
}
