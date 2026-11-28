import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '../-services/email-inbox-api';
import { defaultOpenKeys, foldRows, threadTitle, visibleAttachments } from './email-thread-layout';

let seq = 0;
function msg(partial: Partial<EmailMessage>): EmailMessage {
    seq++;
    return {
        id: `m${seq}`,
        direction: 'INCOMING',
        counterpartyEmail: 'aneesa@ethicx.example',
        timestamp: new Date(Date.UTC(2026, 9, 21, 10, seq)).toISOString(),
        ...partial,
    };
}

const label = (r: ReturnType<typeof foldRows>[number]) =>
    r.kind === 'fold' ? `fold:${r.count}` : r.key;

describe('foldRows', () => {
    it('shows every message of a short thread', () => {
        const messages = [msg({}), msg({}), msg({}), msg({})];
        expect(foldRows(messages, new Set(), false).every((r) => r.kind === 'message')).toBe(true);
    });

    it('folds the middle of a long thread behind one divider, as Gmail does', () => {
        const messages = Array.from({ length: 7 }, () => msg({}));
        expect(foldRows(messages, new Set(), false).map(label)).toEqual([
            messages[0]!.id,
            'fold:4',
            messages[5]!.id,
            messages[6]!.id,
        ]);
    });

    it('keeps an opened message visible inside the fold', () => {
        const messages = Array.from({ length: 7 }, () => msg({}));
        expect(foldRows(messages, new Set([messages[3]!.id]), false).map(label)).toEqual([
            messages[0]!.id,
            'fold:2',
            messages[3]!.id,
            'fold:1',
            messages[5]!.id,
            messages[6]!.id,
        ]);
    });

    it('shows everything once unfolded', () => {
        const messages = Array.from({ length: 7 }, () => msg({}));
        expect(foldRows(messages, new Set(), true).every((r) => r.kind === 'message')).toBe(true);
    });
});

describe('defaultOpenKeys', () => {
    it('opens the newest message and the newest one the person sent', () => {
        const theirs = msg({ direction: 'INCOMING', subject: 'RFQ' });
        const ours = msg({ direction: 'OUTGOING', subject: 'Re: RFQ' });
        expect(defaultOpenKeys([msg({}), theirs, ours])).toEqual([ours.id, theirs.id]);
    });

    it('never opens a bounce just because it is inbound', () => {
        const theirs = msg({ direction: 'INCOMING', subject: 'Hello' });
        const bounce = msg({
            direction: 'INCOMING',
            counterpartyEmail: 'mailer-daemon@amazonses.com',
            subject: 'Delivery Status Notification (Failure)',
        });
        const ours = msg({ direction: 'OUTGOING' });
        expect(defaultOpenKeys([theirs, bounce, ours])).toEqual([ours.id, theirs.id]);
    });

    it('lists the newest message once when it is also theirs', () => {
        const only = msg({ direction: 'INCOMING' });
        expect(defaultOpenKeys([only])).toEqual([only.id]);
    });
});

describe('threadTitle', () => {
    it('uses the subject the person wrote, without the Re:/Fwd: chain', () => {
        const messages = [
            msg({ direction: 'OUTGOING', subject: 'Our campaign' }),
            msg({ direction: 'INCOMING', subject: 'Re: Fwd: RE: Request for Proposal' }),
            msg({ direction: 'OUTGOING', subject: 'Re: Request for Proposal' }),
        ];
        expect(threadTitle(messages)).toBe('Request for Proposal');
    });

    it('falls back to our own subject when they never wrote one', () => {
        const messages = [msg({ direction: 'OUTGOING', subject: 'AI calling for Ace Blend' })];
        expect(threadTitle(messages)).toBe('AI calling for Ace Blend');
    });
});

describe('visibleAttachments', () => {
    const pdf = {
        id: '2',
        filename: 'RFQ.pdf',
        contentType: 'application/pdf',
        size: 346189,
        inline: false,
    };
    const logo = {
        id: '1.2',
        filename: 'logo.png',
        contentType: 'image/png',
        size: 900,
        inline: true,
    };

    it('hides inline images when the HTML body shows them', () => {
        expect(visibleAttachments(msg({ hasHtml: true, attachments: [pdf, logo] }))).toEqual([pdf]);
    });

    it('lists inline images too when there is no HTML to show them in', () => {
        expect(visibleAttachments(msg({ hasHtml: false, attachments: [pdf, logo] }))).toEqual([
            pdf,
            logo,
        ]);
    });

    it('is empty for a message that was never indexed', () => {
        expect(visibleAttachments(msg({}))).toEqual([]);
    });
});
