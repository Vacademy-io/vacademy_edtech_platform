import { describe, expect, it } from 'vitest';

import {
    flattenTemplateBody,
    humanizeTemplateText,
    mediaFileName,
    splitTemplateText,
} from './template-text';

/**
 * Every WhatsApp preview in the admin reads a template through here, and the shape it has to cope
 * with is Meta's: a body that says `Dear {{1}}` with the names living in a parallel array. Getting
 * the index off by one would silently label a message with the wrong field, which an admin has no
 * way to notice before the message is on someone's phone.
 */
describe('splitTemplateText', () => {
    it('names positional placeholders from bodyVariableNames', () => {
        const parts = splitTemplateText('Dear {{1}}, your {{2}} starts today.', {
            variableNames: ['name', 'course_name'],
        });

        expect(parts).toEqual([
            { kind: 'text', text: 'Dear ' },
            { kind: 'variable', token: '1', name: 'name', value: undefined },
            { kind: 'text', text: ', your ' },
            { kind: 'variable', token: '2', name: 'course_name', value: undefined },
            { kind: 'text', text: ' starts today.' },
        ]);
    });

    it('fills placeholders from values keyed by name or by raw token', () => {
        const byName = splitTemplateText('Hi {{1}}', {
            variableNames: ['name'],
            values: { name: 'Priya' },
        });
        const byToken = splitTemplateText('Hi {{1}}', { values: { '1': 'Priya' } });

        expect(byName[1]).toMatchObject({ name: 'name', value: 'Priya' });
        expect(byToken[1]).toMatchObject({ name: '1', value: 'Priya' });
    });

    it('keeps the token when no name exists for that position', () => {
        const parts = splitTemplateText('Hi {{2}}', { variableNames: ['name'] });

        expect(parts[1]).toMatchObject({ token: '2', name: '2' });
    });

    it('finds the first placeholder on every call', () => {
        // A module-level /g regex would keep `lastIndex` and drop this on the second call.
        const first = splitTemplateText('{{1}} hello', { variableNames: ['name'] });
        const second = splitTemplateText('{{1}} hello', { variableNames: ['name'] });

        expect(second).toEqual(first);
        expect(second[0]).toMatchObject({ kind: 'variable', name: 'name' });
    });

    it('returns nothing for an absent body', () => {
        expect(splitTemplateText(undefined)).toEqual([]);
        expect(splitTemplateText('')).toEqual([]);
    });
});

describe('humanizeTemplateText', () => {
    it('reads as the message, not as its placeholders', () => {
        expect(
            humanizeTemplateText('Dear {{1}}, welcome to {{2}}.', {
                variableNames: ['name', 'institute'],
            })
        ).toBe('Dear [name], welcome to [institute].');
    });

    it('prefers a resolved value over the field name', () => {
        expect(
            humanizeTemplateText('Dear {{1}}', {
                variableNames: ['name'],
                values: { name: 'Priya' },
            })
        ).toBe('Dear Priya');
    });

    it('falls back to the name when the resolved value is blank', () => {
        expect(
            humanizeTemplateText('Dear {{1}}', { variableNames: ['name'], values: { name: '  ' } })
        ).toBe('Dear [name]');
    });
});

describe('flattenTemplateBody', () => {
    it('turns email HTML into readable lines', () => {
        expect(flattenTemplateBody('<p>Hi&nbsp;Priya</p><p>Your seat is <b>booked</b>.</p>')).toBe(
            'Hi Priya\nYour seat is booked .'
        );
    });

    it('keeps a WhatsApp body’s paragraphs but caps the blank runs', () => {
        expect(flattenTemplateBody('Line one\n\n\n\nLine two')).toBe('Line one\n\nLine two');
    });

    it('is empty for empty content', () => {
        expect(flattenTemplateBody(undefined)).toBe('');
    });
});

describe('mediaFileName', () => {
    it('strips the upload key prefix and keeps the original name', () => {
        expect(
            mediaFileName(
                'https://d1om4dxj9e7kkd.cloudfront.net/ADMIN_PUBLIC_UPLOAD/63a5262b-f5e4-4de6-990e-d3296ca5012b-HCCA_Updated_Brochure_1.pdf'
            )
        ).toBe('HCCA_Updated_Brochure_1.pdf');
    });

    it('decodes escapes, keeps a literal +, and ignores query strings', () => {
        expect(
            mediaFileName('https://cdn.example.com/f/HCCA%20Syllabus%201.pdf?X-Amz-Expires=1')
        ).toBe('HCCA Syllabus 1.pdf');
        expect(mediaFileName('https://cdn.example.com/f/C++_Notes.pdf')).toBe('C++_Notes.pdf');
    });

    it('is empty when there is nothing to name', () => {
        expect(mediaFileName(undefined)).toBe('');
        expect(mediaFileName('https://cdn.example.com/')).toBe('');
    });
});
