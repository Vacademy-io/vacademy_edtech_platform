import { describe, expect, it } from 'vitest';
import {
    findPdfAttachments,
    hasNonPdfAttachment,
    isInsufficientCreditsError,
    paperDigitiseErrorMessage,
} from '../paper-digitise';

/**
 * The paper in an offline test's description is what the AI checker will be
 * built from, so finding it must follow the same rule the learner page uses to
 * show it: any anchor that points at a PDF, attachment chip or pasted link.
 */
describe('findPdfAttachments', () => {
    it('finds the editor attachment chip and a pasted link, once each', () => {
        const html =
            '<p>Mock test</p>' +
            '<a data-attachment="true" href="https://cdn/x/STUDENTS/abc-half_yearly.pdf" name="Half yearly.pdf" type="application/pdf"><span>Half yearly.pdf</span></a>' +
            '<p><a href="https://cdn/x/STUDENTS/abc-half_yearly.pdf">same file again</a></p>' +
            '<p><a href="https://cdn/other/answer%20key.PDF?x=1">Answer key</a></p>';
        expect(findPdfAttachments(html)).toEqual([
            { url: 'https://cdn/x/STUDENTS/abc-half_yearly.pdf', name: 'Half yearly.pdf' },
            { url: 'https://cdn/other/answer%20key.PDF?x=1', name: 'Answer key' },
        ]);
    });

    it('recognises a PDF by the attachment name or type when the url has no extension', () => {
        const byName = '<a data-attachment="true" href="https://cdn/f/123" name="paper.pdf">paper.pdf</a>';
        const byType = '<a data-attachment="true" href="https://cdn/f/123" type="application/pdf">file</a>';
        expect(findPdfAttachments(byName)).toHaveLength(1);
        expect(findPdfAttachments(byType)).toHaveLength(1);
    });

    it('ignores non-PDF files, empty hrefs and plain text', () => {
        const html =
            '<a data-attachment="true" href="https://cdn/f/notes.docx" name="notes.docx">notes.docx</a>' +
            '<a href="#">nothing</a><p>no links here</p>';
        expect(findPdfAttachments(html)).toEqual([]);
        expect(findPdfAttachments('')).toEqual([]);
    });
});

describe('hasNonPdfAttachment', () => {
    it('is true only for attachment chips that are not PDFs', () => {
        expect(
            hasNonPdfAttachment(
                '<a data-attachment="true" href="https://cdn/f/notes.docx" name="notes.docx">x</a>'
            )
        ).toBe(true);
        expect(
            hasNonPdfAttachment('<a data-attachment="true" href="https://cdn/f/p.pdf" name="p.pdf">x</a>')
        ).toBe(false);
        expect(hasNonPdfAttachment('<a href="https://cdn/f/notes.docx">plain link</a>')).toBe(false);
    });
});

describe('error helpers', () => {
    it('reads the 400 sentence and the 402 nested message', () => {
        expect(
            paperDigitiseErrorMessage({ response: { data: { detail: 'This PDF is password-protected.' } } }, 'x')
        ).toBe('This PDF is password-protected.');
        const insufficient = {
            response: { status: 402, data: { detail: { message: 'Reading this paper needs about 4 credits' } } },
        };
        expect(paperDigitiseErrorMessage(insufficient, 'x')).toBe('Reading this paper needs about 4 credits');
        expect(isInsufficientCreditsError(insufficient)).toBe(true);
        expect(isInsufficientCreditsError(new Error('boom'))).toBe(false);
        expect(paperDigitiseErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
    });
});
