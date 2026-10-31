import { describe, expect, it } from 'vitest';

import strings from '../../../../../../../../public/locales/en/manageStudentsCommunicationTimeline.json';
import {
    canResend,
    originalVariables,
    requiredVariableKeys,
    resendBlockedReason,
    showsResendControl,
} from './resend-message-dialog';
import type { CommunicationItem } from '@/services/communication-timeline-service';

/**
 * Resending is the one button on this timeline that sends a real message to a real learner, so the
 * two decisions in front of it are covered here: WHICH rows may be resent at all, and WHAT the
 * dialog offers to change. Getting either wrong is expensive — a resend button on an inbound
 * message sends nothing, and a WhatsApp row whose variables come back empty would replay a
 * template with the learner's name stripped out.
 */

const lookup = (key: string): string => {
    const value = key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            strings as Record<string, unknown>
        );
    if (typeof value !== 'string') throw new Error(`Missing translation: ${key}`);
    return value;
};

const item = (over: Partial<CommunicationItem> = {}): CommunicationItem => ({
    id: 'log-1',
    channel: 'WHATSAPP',
    direction: 'OUTBOUND',
    title: 'unlockx_registration1',
    bodyPreview: 'Hi Neeju, your registration…',
    fullBody: 'Hi Neeju, your registration is confirmed.',
    templateName: 'unlockx_registration1',
    status: 'DELIVERED',
    statusTimeline: [],
    senderInfo: '918888888888',
    recipientInfo: '919999999999',
    timestamp: '2026-09-21T10:00:00Z',
    source: 'chatbot-flow',
    sourceId: 'wamid.ONE',
    ...over,
});

describe('resendBlockedReason', () => {
    it('allows an outbound WhatsApp template send', () => {
        expect(resendBlockedReason(item())).toBeNull();
        expect(canResend(item())).toBe(true);
    });

    it('allows an outbound email that still has its body', () => {
        expect(
            canResend(item({ channel: 'EMAIL', templateName: undefined, fullBody: '<p>Hi</p>' }))
        ).toBe(true);
    });

    // A received message has no send to replay — resending one would message the learner with
    // their own words.
    it('blocks inbound messages on both channels', () => {
        expect(resendBlockedReason(item({ direction: 'INBOUND' }))).toBe('inbound');
        expect(resendBlockedReason(item({ channel: 'EMAIL', direction: 'INBOUND' }))).toBe(
            'inbound'
        );
    });

    // The send API only speaks templates; a free-text Inbox reply has none, and WhatsApp would
    // refuse it anyway outside the 24h session window.
    it('blocks a free-text WhatsApp message', () => {
        expect(resendBlockedReason(item({ templateName: undefined }))).toBe('noTemplate');
    });

    it('blocks an email whose body was never stored', () => {
        expect(resendBlockedReason(item({ channel: 'EMAIL', fullBody: undefined }))).toBe('noBody');
    });

    it('blocks channels the send path cannot replay from a log row', () => {
        expect(resendBlockedReason(item({ channel: 'PUSH' }))).toBe('unsupportedChannel');
        expect(resendBlockedReason(item({ channel: 'SMS' }))).toBe('unsupportedChannel');
    });
});

describe('showsResendControl', () => {
    // "I can't see the button" is the failure this guards: a blocked row that renders nothing is
    // indistinguishable from the feature not existing, so only inbound rows drop the control.
    it('keeps the control on every outbound row, even ones it cannot replay', () => {
        expect(showsResendControl(item())).toBe(true);
        expect(showsResendControl(item({ templateName: undefined }))).toBe(true);
        expect(showsResendControl(item({ channel: 'EMAIL', fullBody: undefined }))).toBe(true);
        expect(showsResendControl(item({ channel: 'PUSH' }))).toBe(true);
    });

    it('drops it on inbound rows, where resending means nothing', () => {
        expect(showsResendControl(item({ direction: 'INBOUND' }))).toBe(false);
        expect(showsResendControl(item({ channel: 'EMAIL', direction: 'INBOUND' }))).toBe(false);
    });
});

describe('originalVariables', () => {
    it('returns the named params the WhatsApp send recorded', () => {
        const vars = originalVariables(
            item({ metadata: { templateName: 'x', bodyParams: { name: 'Neeju', test: 'NEET' } } }),
            ''
        );
        expect(vars).toEqual({ name: 'Neeju', test: 'NEET' });
    });

    it('keeps positional keys exactly as stored, so the send maps them back', () => {
        const vars = originalVariables(item({ metadata: { bodyParams: { 1: 'Neeju' } } }), '');
        expect(vars).toEqual({ '1': 'Neeju' });
    });

    // _headerUrl / _headerType / _buttonUrl are send-path plumbing injected by UnifiedSendService,
    // not variables an admin wrote — editing them as text fields would corrupt the media header.
    it('hides the send path’s internal underscore keys', () => {
        const vars = originalVariables(
            item({
                metadata: {
                    bodyParams: {
                        name: 'Neeju',
                        _headerUrl: 'https://x/y.png',
                        _headerType: 'image',
                    },
                },
            }),
            ''
        );
        expect(vars).toEqual({ name: 'Neeju' });
    });

    it('survives a row with no payload at all', () => {
        expect(originalVariables(item({ metadata: undefined }), '')).toEqual({});
    });

    // A workflow node with no variable mapping sends `bodyParams: {}`, which Meta rejects. Without
    // the template's own placeholders there would be nothing to fix on the resend.
    it('adds the template’s placeholders the original send left out, empty', () => {
        const vars = originalVariables(item({ metadata: { bodyParams: {} } }), '', {
            bodyText: 'Hi {{1}} 👋 We’ve received your details.',
            bodyVariableNames: ['Name'],
        });
        expect(vars).toEqual({ '1': '' });
    });

    it('keeps the values the send did record beside the ones it missed', () => {
        const vars = originalVariables(
            item({ metadata: { bodyParams: { 1: 'Neeju', _headerUrl: 'https://x/y.png' } } }),
            '',
            { bodyText: 'Hi {{1}}, your {{2}} batch starts soon.' }
        );
        expect(vars).toEqual({ '1': 'Neeju', '2': '' });
    });

    // Workflow sends often store the variables by NAME (the send path maps them to positions
    // through bodyVariableNames). A named value covers its positional placeholder — adding an
    // empty {{1}} beside `name` would block "resend the same" on a send that was complete.
    it('treats a variable stored by name as filling its positional placeholder', () => {
        const vars = originalVariables(
            item({
                metadata: {
                    bodyParams: { name: 'testmansu', email: 'a@b.com', instituteName: 'Vacademy' },
                },
            }),
            '',
            { bodyText: 'Hi {{1}}, welcome!', bodyVariableNames: ['name'] }
        );
        expect(vars).toEqual({ name: 'testmansu', email: 'a@b.com', instituteName: 'Vacademy' });
    });

    it('names a missing variable the way the rest of a named send does', () => {
        const vars = originalVariables(item({ metadata: { bodyParams: { name: 'Asha' } } }), '', {
            bodyText: 'Hi {{1}}, your {{2}} batch starts soon.',
            bodyVariableNames: ['name', 'course'],
        });
        expect(vars).toEqual({ name: 'Asha', course: '' });
    });

    // The send path lower-cases a name and turns anything but [a-z0-9_] into "_".
    it('matches names the way the send path does', () => {
        const vars = originalVariables(
            item({ metadata: { bodyParams: { 'Course Name': 'NEET' } } }),
            '',
            { bodyText: 'Your {{1}} batch', bodyVariableNames: ['course_name'] }
        );
        expect(vars).toEqual({ 'Course Name': 'NEET' });
    });
});

describe('requiredVariableKeys', () => {
    it('is the keys filling the template’s own placeholders, by position or by name', () => {
        const template = {
            bodyText: 'Hi {{1}}, your {{2}} batch',
            bodyVariableNames: ['name', 'course'],
        };
        expect(requiredVariableKeys({ 1: 'A', 2: 'B' }, template)).toEqual(['1', '2']);
        expect(requiredVariableKeys({ name: 'A', course: '', email: '' }, template)).toEqual([
            'name',
            'course',
        ]);
    });

    // A send can carry keys its template never uses (an older mapping sent name, email, …
    // to every template); a blank one of those must not block a resend.
    it('ignores stored keys the template does not use', () => {
        expect(
            requiredVariableKeys(
                { name: 'A', email: '' },
                { bodyText: 'Hi {{1}}', bodyVariableNames: ['name'] }
            )
        ).toEqual(['name']);
    });

    it('requires nothing when the template is not known', () => {
        expect(requiredVariableKeys({ name: '' }, null)).toEqual([]);
    });

    // An email body is stored already rendered, so the only variables left are the ones nothing
    // resolved at send time. They come back empty for the admin to fill in.
    it('finds unresolved placeholders in an email subject and body', () => {
        const vars = originalVariables(
            item({
                channel: 'EMAIL',
                templateName: undefined,
                fullBody: '<p>Dear {{first_name}}, your seat for {{course}} is held.</p>',
            }),
            'Welcome, {{first_name}}'
        );
        expect(vars).toEqual({ first_name: '', course: '' });
    });

    it('reports no variables for a fully rendered email', () => {
        const vars = originalVariables(
            item({
                channel: 'EMAIL',
                templateName: undefined,
                fullBody: '<p>Dear Neeju, your seat is held.</p>',
            }),
            'Welcome to Shiksha Nation'
        );
        expect(vars).toEqual({});
    });
});

describe('resend copy', () => {
    it('has every string the dialog asks for', () => {
        for (const key of [
            'resend.button',
            'resend.buttonTooltip',
            'resend.title',
            'resend.confirmQuestion',
            'resend.subjectLabel',
            'resend.modeSame',
            'resend.modeSameHint',
            'resend.modeSameBlockedHint',
            'resend.variablesRequired',
            'resend.modeEdit',
            'resend.modeEditHint',
            'resend.variablePlaceholder',
            'resend.variableEmpty',
            'resend.previewHeading',
            'resend.deliveryCaveat',
            'resend.cancel',
            'resend.confirmSame',
            'resend.confirmEdited',
            'resend.emailSent',
            'resend.whatsappQueued',
            'resend.rejected',
            'resend.rejectedWithReason',
            'resend.failed',
            'resend.noInstitute',
            'resend.noRecipient',
        ]) {
            expect(lookup(key)).toBeTruthy();
        }
        // Plural key: i18next resolves `resend.hasVariables` through the _one/_other suffixes.
        expect(lookup('resend.hasVariables_one')).toBeTruthy();
        expect(lookup('resend.hasVariables_other')).toBeTruthy();
    });

    // Every non-inbound reason reaches the disabled chip's tooltip, so each needs copy.
    it('explains every reason a row cannot be resent', () => {
        for (const reason of ['noTemplate', 'noBody', 'unsupportedChannel']) {
            expect(lookup(`resend.blocked.${reason}`)).toBeTruthy();
        }
    });

    it('asks before sending rather than announcing a send', () => {
        expect(lookup('resend.confirmQuestion')).toContain('{{recipient}}');
        expect(lookup('resend.confirmQuestion')).toMatch(/\?$/);
    });
});
