import { describe, expect, it } from 'vitest';
import type { AIExtractionSummary } from '@/types/ai/generate-assessment/generate-complete-assessment';
import type { MyQuestion } from '@/types/assessments/question-paper-form';
import {
    DEFAULT_MARK,
    durationFields,
    isBlankDuration,
    isEmptySection,
    pairWithPreview,
    sectionRowFor,
    sectionsFromExtractedPaper,
    wantsSections,
} from './extracted-paper-sections';

const stored = (id: string, type = 'MCQS') =>
    ({
        questionId: id,
        questionName: `Q ${id}`,
        questionType: type,
        questionMark: '',
        questionPenalty: '',
        questionDuration: { hrs: '0', min: '0' },
        multipleChoiceOptions: [{ isSelected: true }, { isSelected: true }, { isSelected: false }],
        parentRichTextContent: null,
    }) as unknown as MyQuestion;

const preview = (id: string, sectionName: string | undefined, mark: string, penalty = '0') =>
    ({
        questionName: `Q ${id}`,
        sectionName,
        questionMark: mark,
        questionPenalty: penalty,
    }) as unknown as MyQuestion;

const summary = (
    mode: 'split' | 'single',
    names: string[],
    minutes?: number
): AIExtractionSummary =>
    ({
        section_mode: mode,
        sections: names.map((name) => ({
            name,
            count: 1,
            instruction: `${name} instructions`,
            duration_minutes: minutes ?? null,
        })),
    }) as unknown as AIExtractionSummary;

describe('sectionsFromExtractedPaper', () => {
    it('builds one section per paper section, in the paper order, with printed marks', () => {
        const sections = sectionsFromExtractedPaper(
            summary('split', ['Section A', 'Section B']),
            [
                preview('1', 'Section A', '1'),
                preview('2', 'Section B', '3', '1'),
                preview('3', 'Section A', '1'),
            ],
            [stored('1'), stored('2', 'LONG_ANSWER'), stored('3')]
        );
        expect(sections.map((s) => s.sectionName)).toEqual(['Section A', 'Section B']);
        expect(sections[0]!.adaptive_marking_for_each_question.map((q) => q.questionId)).toEqual([
            '1',
            '3',
        ]);
        expect(sections[0]!.marks_per_question).toBe('1');
        expect(sections[0]!.total_marks).toBe('2');
        expect(sections[0]!.negative_marking).toEqual({ checked: false, value: '0' });
        expect(sections[0]!.section_description).toBe('Section A instructions');
        expect(sections[1]!.marks_per_question).toBe('3');
        expect(sections[1]!.negative_marking).toEqual({ checked: true, value: '1' });
    });

    it('puts a question the paper gave no section to after the named ones, numbered on', () => {
        const sections = sectionsFromExtractedPaper(
            summary('split', ['Part I']),
            [preview('1', 'Part I', '2'), preview('2', undefined, '2')],
            [stored('1'), stored('2')],
            3
        );
        expect(sections.map((s) => s.sectionName)).toEqual(['Part I', 'Section 5']);
    });

    it('gives a question the paper prices nowhere one mark, and the section its printed time', () => {
        const sections = sectionsFromExtractedPaper(
            summary('split', ['Section A'], 90),
            [preview('1', 'Section A', '0')],
            [stored('1')]
        );
        expect(sections[0]!.adaptive_marking_for_each_question[0]!.questionMark).toBe(DEFAULT_MARK);
        expect(sections[0]!.marks_per_question).toBe('1');
        expect(sections[0]!.total_marks).toBe('1');
        expect(sections[0]!.section_duration).toEqual({ hrs: '1', min: '30' });
        expect(sections[0]!.negative_marking.checked).toBe(false);
    });

    it('leaves the section default blank when marks differ between questions', () => {
        const sections = sectionsFromExtractedPaper(
            summary('split', ['Section C']),
            [preview('1', 'Section C', '3'), preview('2', 'Section C', '5')],
            [stored('1'), stored('2')]
        );
        expect(sections[0]!.marks_per_question).toBe('');
        expect(sections[0]!.total_marks).toBe('8');
    });
});

describe('sectionRowFor', () => {
    it('takes marks from the paper when it has them, else keeps the stored value', () => {
        expect(sectionRowFor(stored('1', 'MCQM'), preview('1', undefined, '4', '1'))).toMatchObject(
            {
                questionMark: '4',
                questionPenalty: '1',
                correctOptionIdsCnt: 2,
            }
        );
        expect(sectionRowFor(stored('1'), undefined)).not.toHaveProperty('correctOptionIdsCnt');
        const kept = { ...stored('2'), questionMark: '7' } as MyQuestion;
        expect(sectionRowFor(kept, preview('2', undefined, '0', '0')).questionMark).toBe('7');
        expect(sectionRowFor(kept, undefined).questionMark).toBe('7');
        // Without a default the old behaviour stands (generated papers keep the section default).
        expect(sectionRowFor(stored('3'), undefined).questionMark).toBe('');
        expect(sectionRowFor(stored('3'), undefined, DEFAULT_MARK).questionMark).toBe('1');
    });
});

describe('durations', () => {
    it('splits minutes into the wizard fields and knows an unset duration', () => {
        expect(durationFields(120)).toEqual({ hrs: '2', min: '0' });
        expect(durationFields(95)).toEqual({ hrs: '1', min: '35' });
        expect(durationFields(null)).toEqual({ hrs: '0', min: '0' });
        expect(isBlankDuration(undefined)).toBe(true);
        expect(isBlankDuration({ hrs: '', min: '' })).toBe(true);
        expect(isBlankDuration({ hrs: '0', min: '0' })).toBe(true);
        expect(isBlankDuration({ hrs: '0', min: '30' })).toBe(false);
    });
});

describe('pairWithPreview', () => {
    it('pairs by position when the counts match and by text when they do not', () => {
        const a = preview('1', 'A', '1');
        const b = preview('2', 'B', '1');
        expect(pairWithPreview([stored('1'), stored('2')], [a, b])).toEqual([a, b]);
        expect(pairWithPreview([stored('2')], [a, b])).toEqual([b]);
        expect(pairWithPreview([stored('9')], [a, b])).toEqual([undefined]);
    });
});

describe('wantsSections', () => {
    it('only when the teacher chose split and the paper has two or more sections', () => {
        expect(wantsSections(summary('split', ['A', 'B']))).toBe(true);
        expect(wantsSections(summary('split', ['A']))).toBe(false);
        expect(wantsSections(summary('single', ['A', 'B']))).toBe(false);
        expect(wantsSections(null)).toBe(false);
    });

    it('a choice made in the preview overrides the one made at upload', () => {
        expect(wantsSections(summary('single', ['A', 'B']), 'split')).toBe(true);
        expect(wantsSections(summary('split', ['A', 'B']), 'single')).toBe(false);
        expect(wantsSections(summary('split', ['A']), 'split')).toBe(false);
    });
});

describe('isEmptySection', () => {
    it('is the blank section the wizard opens with, even if it was described or renamed', () => {
        expect(isEmptySection({ adaptive_marking_for_each_question: [] })).toBe(true);
        expect(
            isEmptySection({
                adaptive_marking_for_each_question: [],
                uploaded_question_paper: null,
            })
        ).toBe(true);
        expect(isEmptySection({ adaptive_marking_for_each_question: [{}] })).toBe(false);
        expect(
            isEmptySection({
                adaptive_marking_for_each_question: [],
                uploaded_question_paper: 'p1',
            })
        ).toBe(false);
    });
});
