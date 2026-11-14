import { describe, expect, it } from 'vitest';
import type { QuestionResponse } from '@/types/assessments/question-paper-template';
import {
    TEMPLATE_EXAMPLES,
    TEMPLATE_HEADERS,
    batchTags,
    blankQuestion,
    chunk,
    countByPath,
    ownDifficulty,
    parseTemplateRows,
    toImportItem,
} from './library-import';

const row = (values: Record<string, string>) =>
    TEMPLATE_HEADERS.map((header) => values[header] ?? '');

const mcqRow = (extra: Record<string, string> = {}) =>
    row({
        Course: 'UPSC',
        Subject: 'Polity',
        Question: 'Which Article protects life?',
        Type: 'MCQ single',
        'Option A': 'Article 14',
        'Option B': 'Article 21',
        'Option C': 'Article 32',
        Answer: 'B',
        ...extra,
    });

interface Payload {
    question_type: string;
    options: { id: string | null; preview_id: number | string; text: { content: string } }[];
    auto_evaluation_json: string;
    text: { content: string };
}

describe('parseTemplateRows', () => {
    it('reads the template examples without problems', () => {
        const result = parseTemplateRows([TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES]);
        expect(result.errors).toEqual([]);
        expect(result.drafts).toHaveLength(2);
        expect(result.drafts[0]!.path).toEqual([
            'UPSC',
            'Polity',
            'Fundamental Rights',
            'Right to Life',
        ]);
        expect(result.drafts[0]!.difficulty).toBe('EASY');
        expect(result.drafts[0]!.tags).toEqual([
            { kind: 'CONCEPT', name: 'Article 21' },
            { kind: 'PYQ', name: 'UPSC 2019' },
            { kind: 'SOURCE', name: 'Laxmikanth' },
        ]);
        expect(result.drafts[1]!.question.question_type).toBe('NUMERIC');
    });

    it('matches headers by name in any order and case', () => {
        const header = ['question', 'COURSE', 'type', 'answer', 'option b', 'option a'];
        const result = parseTemplateRows([header, ['2 + 2?', 'Maths', 'mcq', 'b', '4', '3']]);
        expect(result.errors).toEqual([]);
        expect(result.drafts[0]!.path).toEqual(['Maths']);
    });

    it('reports each bad row with its sheet row number and skips blank rows', () => {
        const result = parseTemplateRows([
            TEMPLATE_HEADERS,
            mcqRow({ Course: '' }),
            row({}),
            mcqRow({ Question: '' }),
            mcqRow({ Type: 'essay-ish' }),
            mcqRow({ 'Option B': '', 'Option C': '' }),
            mcqRow({ Answer: 'D' }),
            mcqRow({ Answer: 'A,B' }),
            mcqRow({ Type: 'Numeric', Answer: 'two' }),
            mcqRow({ Difficulty: 'Brutal' }),
            mcqRow({ Type: 'True/False', Answer: 'maybe' }),
            mcqRow(),
        ]);
        expect(result.blankRows).toBe(1);
        expect(result.errors).toEqual([
            { row: 2, problem: 'noCourse' },
            { row: 4, problem: 'noQuestion' },
            { row: 5, problem: 'badType' },
            { row: 6, problem: 'fewOptions' },
            { row: 7, problem: 'badAnswer' },
            { row: 8, problem: 'badAnswer' },
            { row: 9, problem: 'badNumber' },
            { row: 10, problem: 'badDifficulty' },
            { row: 11, problem: 'badAnswer' },
        ]);
        expect(result.drafts).toHaveLength(1);
        expect(result.drafts[0]!.row).toBe(12);
    });

    it('escapes HTML typed into a cell', () => {
        const result = parseTemplateRows([
            TEMPLATE_HEADERS,
            mcqRow({ Question: 'Is 2 < 3 & 3 > 2?' }),
        ]);
        expect(result.drafts[0]!.question.text.content).toBe('Is 2 &lt; 3 &amp; 3 &gt; 2?');
    });
});

describe('toImportItem', () => {
    it('turns an Excel MCQ into the save payload with the key on the right option', () => {
        const [draft] = parseTemplateRows([TEMPLATE_HEADERS, mcqRow()]).drafts;
        const item = toImportItem(draft!);
        const payload = item.question as Payload;

        expect(item.path).toEqual(['UPSC', 'Polity']);
        expect(payload.question_type).toBe('MCQS');
        expect(payload.options.map((o) => o.text.content)).toEqual([
            'Article 14',
            'Article 21',
            'Article 32',
        ]);
        expect(payload.options.every((o) => o.id === null)).toBe(true);
        const key = JSON.parse(payload.auto_evaluation_json).data.correctOptionIds;
        // The second option, by its position: the backend maps preview ids to new options.
        expect(key).toEqual(['1']);
        expect(String(payload.options[1]!.preview_id)).toBe('1');
    });

    it('drops the ids an uploaded question came with, keeping its answer', () => {
        const uploaded = {
            id: 'old-q',
            question_type: 'MCQS',
            text: { content: 'Q' },
            explanation_text: { content: '' },
            options: [
                { id: 'old-a', preview_id: null, text: { content: 'A' } },
                { id: 'old-b', preview_id: null, text: { content: 'B' } },
            ],
            auto_evaluation_json: JSON.stringify({
                type: 'MCQS',
                data: { correctOptionIds: ['old-b'] },
            }),
        } as unknown as QuestionResponse;
        const payload = toImportItem({
            key: 'k',
            question: uploaded,
            difficulty: 'HARD',
            path: [],
            tags: [],
        }).question as Payload & { id: string | null };

        expect(payload.id).toBeNull();
        expect(payload.options.every((o) => o.id === null)).toBe(true);
        expect(JSON.parse(payload.auto_evaluation_json).data.correctOptionIds).toEqual(['1']);
    });

    it('keeps numeric answers', () => {
        const [draft] = parseTemplateRows([
            TEMPLATE_HEADERS,
            mcqRow({ Type: 'Numeric', Answer: '2.5' }),
        ]).drafts;
        const payload = toImportItem(draft!).question as Payload;
        expect(JSON.parse(payload.auto_evaluation_json).data.validAnswers).toEqual([2.5]);
    });
});

describe('helpers', () => {
    it('reads the difficulty AI and uploads carry, else MEDIUM', () => {
        expect(ownDifficulty({ ai_difficulty_level: 'hard' })).toBe('HARD');
        expect(ownDifficulty({ level: 'Easy' })).toBe('EASY');
        expect(ownDifficulty({})).toBe('MEDIUM');
    });

    it('builds shared tags from comma lists', () => {
        expect(batchTags('Article 21, Preamble', '', 'NCERT;')).toEqual([
            { kind: 'CONCEPT', name: 'Article 21' },
            { kind: 'CONCEPT', name: 'Preamble' },
            { kind: 'SOURCE', name: 'NCERT' },
        ]);
    });

    it('chunks and counts', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        const drafts = parseTemplateRows([
            TEMPLATE_HEADERS,
            mcqRow(),
            mcqRow(),
            ...TEMPLATE_EXAMPLES,
        ]).drafts;
        expect(countByPath(drafts)[0]).toEqual({ path: 'UPSC › Polity', count: 2 });
    });

    it('gives a blank MCQ four empty options and True/False its two', () => {
        expect(blankQuestion('MCQS').options).toHaveLength(4);
        expect(blankQuestion('TRUE_FALSE').options.map((o) => o.text?.content)).toEqual([
            'True',
            'False',
        ]);
        expect(blankQuestion('NUMERIC').options).toHaveLength(0);
    });
});
