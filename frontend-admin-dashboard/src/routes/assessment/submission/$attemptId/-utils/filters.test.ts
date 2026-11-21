import { describe, expect, it } from 'vitest';
import { qrow } from '@/services/submission-review/test-fixtures';
import {
    cardKindFor,
    filterCounts,
    filterSections,
    firstAnswerPage,
    normaliseAnswerPages,
    parseKey,
    parseRowFilter,
} from './filters';

const rows = [
    qrow({ key: 's1:q1', question_type: 'MCQS', state: 'MARKED', marks: 2 }),
    qrow({ key: 's2:q2', question_type: 'CBE_RESPONSE', state: 'NEEDS_MARKING' }),
    qrow({ key: 's2:q3', state: 'AI_DRAFT' }),
    qrow({ key: 's2:q4', state: 'MARKED', ai_checking: true, changed_after_release: true }),
];
const sections = [
    { section_id: 's1', name: 'A', questions: rows.slice(0, 1) },
    { section_id: 's2', name: 'B', questions: rows.slice(1) },
];

describe('filters', () => {
    it('counts each chip', () => {
        expect(filterCounts(rows)).toEqual({ all: 4, needs_marking: 1, ai: 2, changed: 1 });
    });
    it('puts an answer the AI is checking under AI, not Needs marking (server counts split the same way)', () => {
        const checking = qrow({ key: 's2:q5', question_type: 'CBE_RESPONSE', state: 'NEEDS_MARKING', ai_checking: true });
        expect(filterCounts([...rows, checking])).toEqual({ all: 5, needs_marking: 1, ai: 3, changed: 1 });
    });
    it('drops sections a filter empties, keeps all sections for "all"', () => {
        expect(filterSections(sections, 'needs_marking', null).map((s) => s.section_id)).toEqual(['s2']);
        expect(filterSections(sections, 'all', null)).toHaveLength(2);
        expect(filterSections(sections, 'all', 's1')).toHaveLength(1);
    });
    it('parses the search params', () => {
        expect(parseRowFilter('ai')).toBe('ai');
        expect(parseRowFilter('nope')).toBeUndefined();
        expect(parseKey('s2:q3')).toEqual({ sectionId: 's2', questionId: 'q3' });
        expect(parseKey('bad')).toBeNull();
    });
});

describe('cardKindFor', () => {
    it('picks the card by test kind first, then question type', () => {
        expect(cardKindFor({ question_type: 'MCQS' }, 'ONLINE')).toBe('objective');
        expect(cardKindFor({ question_type: 'CODING' }, 'ONLINE')).toBe('coding');
        expect(cardKindFor({ question_type: 'CBE_RESPONSE' }, 'ONLINE')).toBe('cbe');
        expect(cardKindFor({ question_type: 'LONG_ANSWER' }, 'HOMEWORK')).toBe('long');
        expect(cardKindFor({ question_type: 'LONG_ANSWER' }, 'SCANNED')).toBe('handwritten');
        expect(cardKindFor({ question_type: 'MCQS' }, 'OMR')).toBe('omr');
    });
});

describe('answer pages', () => {
    it('prefers the layout map page index, then the id digits, then the teacher tag', () => {
        expect(firstAnswerPage(['pg-x'], null, { 'pg-x': 2 })).toBe(3);
        expect(firstAnswerPage(['p4'], '1')).toBe(4);
        expect(firstAnswerPage([], '3,4')).toBe(3);
        expect(firstAnswerPage(null, null)).toBeNull();
    });
    it('normalises what a teacher types', () => {
        expect(normaliseAnswerPages(' 3, 4 4 ')).toBe('3,4');
        expect(normaliseAnswerPages('')).toBe('');
        expect(normaliseAnswerPages('three')).toBeNull();
        expect(normaliseAnswerPages('0')).toBeNull();
    });
});
