import { describe, expect, it } from 'vitest';
import {
    extractBouncedRecipients,
    isSystemMessage,
    isSystemSender,
    looksLikeUuid,
    resolveOrigin,
    splitQuotedReply,
} from './email-text';

/**
 * The inbound body exactly as prod stored it for the screenshot the owner sent: Gmail wrapped
 * the "On … wrote:" header over two lines, and the quoted chain below it carried the campaign's
 * unsubscribe footer. The admin only ever wanted to read the first line.
 */
const GMAIL_REPLY =
    'hello reply trytutezy.com\n\nOn Mon, Sep 14, 2026 at 2:14 PM Shreyash Jain <shreyash@trytutezy.com>\nwrote:\n\n> hello boss\n>\n> i am neeraj';

describe('splitQuotedReply', () => {
    it('separates the typed line from a wrapped Gmail "On … wrote:" chain', () => {
        const result = splitQuotedReply(GMAIL_REPLY);
        expect(result.main).toBe('hello reply trytutezy.com');
        expect(result.quoted?.startsWith('On Mon')).toBe(true);
        expect(result.quoted).toContain('> i am neeraj');
        expect(result.quotedLineCount).toBe(6);
    });

    it('handles the single-line "On … wrote:" header', () => {
        const result = splitQuotedReply(
            'Thanks!\n\nOn Tue, 1 Sep 2026 at 10:00, A <a@x.com> wrote:\n> old text'
        );
        expect(result.main).toBe('Thanks!');
        expect(result.quoted).toBe('On Tue, 1 Sep 2026 at 10:00, A <a@x.com> wrote:\n> old text');
        expect(result.quotedLineCount).toBe(2);
    });

    it('treats the first ">" line as the start of the quote when there is no header', () => {
        const result = splitQuotedReply('ok\n> earlier\n> lines');
        expect(result.main).toBe('ok');
        expect(result.quoted).toBe('> earlier\n> lines');
    });

    it('folds a ">" block that follows a blank line even when unprefixed lines trail it', () => {
        const result = splitQuotedReply('ok\n\n> earlier\n> lines\nsignature');
        expect(result.main).toBe('ok');
        expect(result.quoted).toBe('> earlier\n> lines\nsignature');
    });

    it('keeps a ">" the person typed mid-message in main', () => {
        const result = splitQuotedReply(
            'Numbers:\n> 100 students enrolled\nthanks, please call me'
        );
        expect(result.quoted).toBeNull();
        expect(result.main).toBe('Numbers:\n> 100 students enrolled\nthanks, please call me');
    });

    it('recognises the French / German / Spanish Gmail attribution lines', () => {
        const fr = splitQuotedReply(
            'Merci !\n\nLe lun. 14 sept. 2026 à 14:14, Shreyash Jain <s@x.com> a écrit :\n> bonjour'
        );
        expect(fr.main).toBe('Merci !');
        expect(fr.quoted?.startsWith('Le lun.')).toBe(true);

        const de = splitQuotedReply(
            'Danke\n\nAm Mo., 14. Sept. 2026 um 14:14 Uhr schrieb A <a@x.com>:\n> hallo'
        );
        expect(de.main).toBe('Danke');
        expect(de.quoted?.startsWith('Am Mo.')).toBe(true);

        const es = splitQuotedReply(
            'Gracias\n\nEl lun, 14 sept 2026 a las 14:14, A (<a@x.com>)\nescribió:\n\n> hola'
        );
        expect(es.main).toBe('Gracias');
        expect(es.quoted?.startsWith('El lun')).toBe(true);
    });

    it('recognises the Outlook "-----Original Message-----" divider', () => {
        const result = splitQuotedReply('Noted.\n\n-----Original Message-----\nFrom: x\nSent: y');
        expect(result.main).toBe('Noted.');
        expect(result.quoted?.startsWith('-----Original Message-----')).toBe(true);
    });

    it('recognises the underscore rule and the "From:/Sent:" Outlook header pair', () => {
        expect(splitQuotedReply('a\n______________________________\nold').main).toBe('a');
        const outlook = splitQuotedReply(
            'a\n\nFrom: Bob <b@x.com>\nSent: Monday\nTo: me\nSubject: hi'
        );
        expect(outlook.main).toBe('a');
        expect(outlook.quoted?.startsWith('From: Bob')).toBe(true);
    });

    it('does not treat a sentence beginning with "On" as a quote header', () => {
        const result = splitQuotedReply('On Monday we can meet.\nLet me know.');
        expect(result.quoted).toBeNull();
        expect(result.main).toBe('On Monday we can meet.\nLet me know.');
    });

    it('keeps the whole text as main when nothing precedes the quote', () => {
        const result = splitQuotedReply('> only quoted\n> lines');
        expect(result.main).toBe('> only quoted\n> lines');
        expect(result.quoted).toBeNull();
        expect(result.quotedLineCount).toBe(0);
    });

    it('returns plain text untouched', () => {
        expect(splitQuotedReply('just a note')).toEqual({
            main: 'just a note',
            quoted: null,
            quotedLineCount: 0,
        });
        expect(splitQuotedReply('')).toEqual({ main: '', quoted: null, quotedLineCount: 0 });
    });
});

describe('isSystemSender', () => {
    it('flags bounce daemons and AWS notifiers by local part, case-insensitively', () => {
        expect(isSystemSender('mailer-daemon@ap-south-1.amazonses.com')).toBe(true);
        expect(isSystemSender('MAILER-DAEMON@amazonses.com')).toBe(true);
        expect(isSystemSender('postmaster@example.com')).toBe(true);
        expect(isSystemSender('no-reply-aws@amazon.com')).toBe(true);
        expect(isSystemSender('bounces@example.com')).toBe(true);
    });

    it('flags delivery-failure subjects from any address', () => {
        expect(isSystemSender('someone@x.com', 'Delivery Status Notification (Failure)')).toBe(
            true
        );
        expect(isSystemSender(undefined, 'Undeliverable: hello')).toBe(true);
        expect(isSystemSender(undefined, 'Mail delivery failed: returning message')).toBe(true);
    });

    it('leaves real people alone', () => {
        expect(isSystemSender('neeraj@vidyayatan.com', 'Re: hello neeraj')).toBe(false);
        expect(isSystemSender('bounce-back@x.com')).toBe(false);
        expect(isSystemSender()).toBe(false);
    });
});

describe('looksLikeUuid', () => {
    it('matches the parent-log id that used to leak through "source"', () => {
        expect(looksLikeUuid('F9E8AD65-A66F-4A53-A97B-E855B48ABD26')).toBe(true);
        expect(looksLikeUuid('f9e8ad65-a66f-4a53-a97b-e855b48abd26')).toBe(true);
    });
    it('rejects service names and empties', () => {
        expect(looksLikeUuid('unified-send')).toBe(false);
        expect(looksLikeUuid('')).toBe(false);
        expect(looksLikeUuid(undefined)).toBe(false);
    });
});

describe('resolveOrigin', () => {
    it('trusts the backend origin when present', () => {
        expect(resolveOrigin({ direction: 'OUTGOING', origin: 'CAMPAIGN' })).toBe('CAMPAIGN');
        expect(resolveOrigin({ direction: 'INCOMING', origin: 'REPLY', source: 'x' })).toBe(
            'REPLY'
        );
    });

    it('maps the producer tag of an outgoing row the way the backend does', () => {
        expect(resolveOrigin({ direction: 'OUTGOING', source: 'announcement-service' })).toBe(
            'CAMPAIGN'
        );
        expect(resolveOrigin({ direction: 'OUTGOING', source: 'EMAIL_INBOX' })).toBe('INBOX_REPLY');
        expect(resolveOrigin({ direction: 'OUTGOING', source: 'OTP_SERVICE' })).toBe('OTP');
        expect(resolveOrigin({ direction: 'OUTGOING', source: 'ENGAGEMENT_ENGINE' })).toBe(
            'AUTOMATION'
        );
        expect(resolveOrigin({ direction: 'OUTGOING', source: 'event:LEARNER_ENROLLED' })).toBe(
            'AUTOMATION'
        );
        expect(resolveOrigin({ direction: 'OUTGOING' })).toBe('EMAIL');
    });

    it('derives from the raw fields on an older backend', () => {
        expect(resolveOrigin({ direction: 'OUTGOING', source: 'unified-send' })).toBe('EMAIL');
        expect(
            resolveOrigin({
                direction: 'INCOMING',
                source: 'F9E8AD65-A66F-4A53-A97B-E855B48ABD26',
                counterpartyEmail: 'neeraj@vidyayatan.com',
            })
        ).toBe('REPLY');
        expect(
            resolveOrigin({ direction: 'INCOMING', counterpartyEmail: 'neeraj@vidyayatan.com' })
        ).toBe('INCOMING');
        expect(
            resolveOrigin({
                direction: 'INCOMING',
                source: 'F9E8AD65-A66F-4A53-A97B-E855B48ABD26',
                counterpartyEmail: 'mailer-daemon@ap-south-1.amazonses.com',
                subject: 'Delivery Status Notification (Failure)',
            })
        ).toBe('BOUNCE');
    });

    it('isSystemMessage honours either the flag or the derived bounce verdict', () => {
        expect(isSystemMessage({ direction: 'INCOMING', system: true })).toBe(true);
        expect(
            isSystemMessage({ direction: 'INCOMING', counterpartyEmail: 'postmaster@x.com' })
        ).toBe(true);
        expect(isSystemMessage({ direction: 'INCOMING', counterpartyEmail: 'a@x.com' })).toBe(
            false
        );
    });
});

describe('extractBouncedRecipients', () => {
    it('reads the SES "following recipients" block', () => {
        expect(
            extractBouncedRecipients(
                "An error occurred while trying to deliver the mail to the following recipients:\nsupport@tutezy.ai\n\n** Address not found **\n\nYour message wasn't delivered to shre+harp@vidyayatan.com because the address couldn't be found."
            )
        ).toEqual(['support@tutezy.ai']);
    });

    it('reads the Gmail and Outlook prose when SES gave no list', () => {
        expect(
            extractBouncedRecipients(
                "** Address not found **\n\nYour message wasn't delivered to sh2@vidyayatan.com because the address couldn't be found, or is unable to receive mail."
            )
        ).toEqual(['sh2@vidyayatan.com']);
        expect(
            extractBouncedRecipients(
                "[https://products.office.com/logo.png]\nYour message to proposals@nsdcindia.org couldn't be delivered.\nThe group proposals only accepts messages from people in its organization."
            )
        ).toEqual(['proposals@nsdcindia.org']);
    });

    it('prefers the DSN fields and de-duplicates', () => {
        expect(
            extractBouncedRecipients(
                'Original-Recipient: rfc822;Someone@Example.com\nFinal-Recipient: rfc822; someone@example.com\nAction: failed'
            )
        ).toEqual(['someone@example.com']);
    });

    it('returns nothing for bodies without a recognisable address', () => {
        expect(extractBouncedRecipients('')).toEqual([]);
        expect(extractBouncedRecipients(undefined)).toEqual([]);
        expect(extractBouncedRecipients('Delivery has failed.')).toEqual([]);
    });
});
