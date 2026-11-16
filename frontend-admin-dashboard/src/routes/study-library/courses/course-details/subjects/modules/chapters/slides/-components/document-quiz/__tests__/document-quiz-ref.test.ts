import { describe, expect, it } from 'vitest';
import {
    DOCUMENT_QUIZ_MAX_LENGTH,
    isDocumentQuizSlide,
    parseDocumentQuizRef,
    quizTitleAfterRename,
    serializeDocumentQuizRef,
} from '../document-quiz-ref';

const FILE_ID = '3f1c2b9a-6d4e-4f7a-9b1c-2d3e4f5a6b7c';

describe('serializeDocumentQuizRef / parseDocumentQuizRef', () => {
    it('round-trips a PDF reference', () => {
        const raw = serializeDocumentQuizRef({
            fileId: FILE_ID,
            fileName: 'Balance sheet.pdf',
            source: 'PDF',
        });
        expect(JSON.parse(raw)).toEqual({
            kind: 'DOCUMENT_QUIZ',
            v: 1,
            file_id: FILE_ID,
            file_name: 'Balance sheet.pdf',
            source: 'PDF',
        });
        expect(parseDocumentQuizRef(raw)).toEqual({
            fileId: FILE_ID,
            fileName: 'Balance sheet.pdf',
            source: 'PDF',
        });
    });

    it('keeps the PPT source and trims the file id', () => {
        const raw = serializeDocumentQuizRef({
            fileId: `  ${FILE_ID} `,
            fileName: 'Deck.pdf',
            source: 'PPT',
        });
        expect(parseDocumentQuizRef(raw)).toEqual({
            fileId: FILE_ID,
            fileName: 'Deck.pdf',
            source: 'PPT',
        });
    });

    it('shortens a long file name so the marker fits quiz_slide.title, never the id', () => {
        const longName = `${'ledger '.repeat(80)}.pdf`;
        const raw = serializeDocumentQuizRef({
            fileId: FILE_ID,
            fileName: longName,
            source: 'PDF',
        });
        expect(raw.length).toBeLessThanOrEqual(DOCUMENT_QUIZ_MAX_LENGTH);
        const parsed = parseDocumentQuizRef(raw);
        expect(parsed?.fileId).toBe(FILE_ID);
        expect(longName.startsWith(parsed?.fileName ?? 'x')).toBe(true);
        expect(parsed?.fileName.length).toBeGreaterThan(0);
    });

    it('counts escaped characters and non-Latin names against the limit', () => {
        const quoted = serializeDocumentQuizRef({
            fileId: FILE_ID,
            fileName: '"'.repeat(300),
            source: 'PDF',
        });
        expect(quoted.length).toBeLessThanOrEqual(DOCUMENT_QUIZ_MAX_LENGTH);
        const hindi = serializeDocumentQuizRef({
            fileId: FILE_ID,
            fileName: 'लेखा'.repeat(100),
            source: 'PDF',
        });
        expect(hindi.length).toBeLessThanOrEqual(DOCUMENT_QUIZ_MAX_LENGTH);
        expect(parseDocumentQuizRef(hindi)?.fileId).toBe(FILE_ID);
    });

    it('refuses a missing document', () => {
        expect(() =>
            serializeDocumentQuizRef({ fileId: '  ', fileName: 'x.pdf', source: 'PDF' })
        ).toThrow();
    });

    it('treats every ordinary quiz title as a plain quiz', () => {
        for (const title of [
            undefined,
            null,
            '',
            'Quiz',
            'Untitled Quiz',
            'Chapter 1 quiz {revision}',
            '{not json',
            '[]',
            '{"kind":"OTHER","file_id":"x"}',
            '{"kind":"DOCUMENT_QUIZ"}',
            '{"kind":"DOCUMENT_QUIZ","file_id":"   "}',
            '{"kind":"DOCUMENT_QUIZ","file_id":42}',
            42,
        ]) {
            expect(parseDocumentQuizRef(title)).toBeNull();
        }
    });

    it('defaults an unknown source to PDF and a missing name to blank', () => {
        expect(
            parseDocumentQuizRef('{"kind":"DOCUMENT_QUIZ","file_id":"f1","source":"DOCX"}')
        ).toEqual({
            fileId: 'f1',
            fileName: '',
            source: 'PDF',
        });
    });
});

describe('isDocumentQuizSlide', () => {
    const marker = serializeDocumentQuizRef({ fileId: FILE_ID, fileName: 'a.pdf', source: 'PDF' });

    it('is true only for QUIZ slides that carry the marker', () => {
        expect(isDocumentQuizSlide({ source_type: 'QUIZ', quiz_slide: { title: marker } })).toBe(
            true
        );
        expect(isDocumentQuizSlide({ source_type: 'quiz', quiz_slide: { title: marker } })).toBe(
            true
        );
        expect(isDocumentQuizSlide({ source_type: 'QUIZ', quiz_slide: { title: 'Quiz 1' } })).toBe(
            false
        );
        expect(isDocumentQuizSlide({ source_type: 'QUIZ', quiz_slide: null })).toBe(false);
        expect(
            isDocumentQuizSlide({ source_type: 'DOCUMENT', quiz_slide: { title: marker } })
        ).toBe(false);
        expect(isDocumentQuizSlide(null)).toBe(false);
    });
});

describe('quizTitleAfterRename', () => {
    it('keeps the document marker when a Document + Quiz slide is renamed', () => {
        const marker = serializeDocumentQuizRef({
            fileId: FILE_ID,
            fileName: 'a.pdf',
            source: 'PDF',
        });
        expect(quizTitleAfterRename(marker, 'New name')).toBe(marker);
    });

    it('follows the new heading for a plain quiz, as before', () => {
        expect(quizTitleAfterRename('Chapter 1 quiz', 'New name')).toBe('New name');
        expect(quizTitleAfterRename(undefined, 'New name')).toBe('New name');
        expect(quizTitleAfterRename(null, 'New name')).toBe('New name');
        expect(quizTitleAfterRename('{"kind":"OTHER","file_id":"x"}', 'New name')).toBe('New name');
    });
});
