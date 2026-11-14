import { describe, expect, it } from 'vitest';
import type {
    Blueprint,
    BlueprintRow,
    RawPaperQuestion,
} from '@/routes/knowledge-base/-types/paper';
import type { MyQuestion } from '@/types/assessments/question-paper-form';
import {
    isUntouchedSection,
    offlineTestInstructionsHtml,
    paperAttachmentHtml,
    sectionsFromKbPaper,
    seedOfflineTestWizard,
} from './kb-paper-sections';
import { useBasicInfoStore } from './zustand-global-states/step1-basic-info';
import { useSectionDetailsStore } from './zustand-global-states/step2-add-questions';

const row = (id: string, section: string, marks: number, topic = 'Acids'): BlueprintRow => ({
    id,
    section,
    topic,
    node_ids: [],
    page_start: null,
    page_end: null,
    question_type: 'MCQS',
    count: 1,
    marks_each: marks,
    difficulty: 'MEDIUM',
    instruction: section === 'Section A' ? 'Attempt all.' : null,
    total_marks: marks,
});

const blueprint: Blueprint = {
    title: 'Class 10 Science — Unit Test',
    rows: [
        row('row-1', 'Section A', 1),
        row('row-2', 'Section A', 1),
        row('row-3', 'Section B', 3, 'Metals'),
    ],
    duration_minutes: 90,
    instructions: ['All questions are compulsory.', 'Draw diagrams where needed.'],
    language: 'English',
    notes: [],
    total_questions: 3,
    total_marks: 5,
};

const raw = (rowId: string) => ({ kb_meta: { row_id: rowId } }) as unknown as RawPaperQuestion;

const stored = (id: string, type = 'MCQS') =>
    ({
        questionId: id,
        questionName: `Q ${id}`,
        questionType: type,
        multipleChoiceOptions: [{ isSelected: true }, { isSelected: true }, { isSelected: false }],
        parentRichTextContent: null,
    }) as unknown as MyQuestion;

describe('sectionsFromKbPaper', () => {
    it('groups questions by the plan row they were written for, marks from the row', () => {
        const sections = sectionsFromKbPaper(
            blueprint,
            [raw('row-1'), raw('row-3'), raw('row-2')],
            [stored('q1'), stored('q3', 'MCQM'), stored('q2')]
        );
        expect(sections.map((s) => s.sectionName)).toEqual(['Section A', 'Section B']);
        expect(sections[0]!.adaptive_marking_for_each_question.map((q) => q.questionId)).toEqual([
            'q1',
            'q2',
        ]);
        expect(sections[0]!.marks_per_question).toBe('1');
        expect(sections[0]!.total_marks).toBe('2');
        expect(sections[0]!.section_description).toBe('Attempt all.');
        expect(sections[1]!.adaptive_marking_for_each_question[0]).toMatchObject({
            questionId: 'q3',
            questionMark: '3',
            correctOptionIdsCnt: 2,
        });
        // New sections have no id yet — that is what makes Step 2 send them as added.
        expect(sections.every((s) => s.sectionId === '')).toBe(true);
    });

    it('falls back to the paper title when a question has no row', () => {
        const sections = sectionsFromKbPaper(blueprint, [raw('gone')], [stored('q9')]);
        expect(sections).toHaveLength(1);
        expect(sections[0]!.sectionName).toBe(blueprint.title);
    });
});

describe('isUntouchedSection', () => {
    const blank = sectionsFromKbPaper(blueprint, [], [])[0] ?? {
        sectionId: '',
        sectionName: 'Section 1',
        questionPaperTitle: '',
        subject: '',
        yearClass: '',
        uploaded_question_paper: null,
        question_duration: { hrs: '0', min: '0' },
        section_description: '',
        section_duration: { hrs: '0', min: '0' },
        marks_per_question: '0',
        total_marks: '',
        negative_marking: { checked: false, value: '0' },
        partial_marking: false,
        cutoff_marks: { checked: false, value: '0' },
        problem_randomization: false,
        adaptive_marking_for_each_question: [],
    };

    it('recognises the blank section Step 2 opens with', () => {
        expect(isUntouchedSection(blank)).toBe(true);
    });

    it('is not keyed on the (localised) default name', () => {
        expect(isUntouchedSection({ ...blank, sectionName: 'सेक्शन 1' })).toBe(true);
    });

    it('keeps anything a teacher has put content into', () => {
        expect(isUntouchedSection({ ...blank, section_description: 'Read carefully' })).toBe(false);
        expect(isUntouchedSection({ ...blank, uploaded_question_paper: 'paper-1' })).toBe(false);
        expect(
            isUntouchedSection({
                ...blank,
                adaptive_marking_for_each_question: [
                    {
                        questionName: 'Q',
                        questionType: 'MCQS',
                        questionMark: '1',
                        questionPenalty: '0',
                        questionDuration: { hrs: '0', min: '0' },
                    },
                ],
            })
        ).toBe(false);
    });
});

describe('offlineTestInstructionsHtml', () => {
    it('writes the header lines, the paper attachment and the plan instructions', () => {
        const html = offlineTestInstructionsHtml(blueprint, {
            url: 'https://bucket/kb-papers/x/Class 10.pdf',
            fileName: 'Class 10.pdf',
        });
        expect(html).toContain('<strong>Test Name - Class 10 Science — Unit Test</strong>');
        expect(html).toContain('<strong>Total Marks - 5</strong>');
        expect(html).toContain('<strong>Test duration - 90 minutes</strong>');
        expect(html).toContain('<strong>Topic - Acids; Metals</strong>');
        // The learner instruction page lifts exactly this anchor shape into a PDF viewer.
        expect(html).toContain(
            '<a data-attachment="true" href="https://bucket/kb-papers/x/Class 10.pdf" target="_blank" rel="noopener noreferrer" name="Class 10.pdf" type="application/pdf"'
        );
        expect(html).toContain('<li>All questions are compulsory.</li>');
        expect(html).toContain('<strong>Upload Answer</strong>');
    });

    it('leaves the attachment out when the paper could not be published, and escapes text', () => {
        const html = offlineTestInstructionsHtml(
            { ...blueprint, title: 'Acids & <Bases>', duration_minutes: 120, instructions: [] },
            null
        );
        expect(html).not.toContain('data-attachment');
        expect(html).toContain('Test Name - Acids &amp; &lt;Bases&gt;');
        expect(html).toContain('Test duration - 2 hours');
        expect(html).not.toContain('<ol>');
    });

    it('escapes the file name and url in the attachment', () => {
        expect(paperAttachmentHtml('https://x/a"b.pdf', 'a"b.pdf')).toContain(
            'href="https://x/a&quot;b.pdf"'
        );
    });
});

describe('seedOfflineTestWizard', () => {
    it('fills Step 1 and Step 2 stores and clears whatever a previous wizard left', () => {
        useBasicInfoStore.getState().setBasicInfo({
            testCreation: { assessmentName: 'old', liveDateRange: { startDate: 'x' } },
            aiEvaluationEnabled: false,
        });
        useSectionDetailsStore.getState().setSectionDetails({ status: 'COMPLETE' });

        const sections = sectionsFromKbPaper(blueprint, [raw('row-1')], [stored('q1')]);
        seedOfflineTestWizard({ blueprint, sections, instructionsHtml: '<p>hi</p>' });

        const basic = useBasicInfoStore.getState();
        expect(basic.testCreation).toEqual({
            assessmentName: 'Class 10 Science — Unit Test',
            assessmentInstructions: '<p>hi</p>',
        });
        expect(basic.resultType).toBe('MANUAL');
        expect(basic.submissionType).toBe('PDF');
        expect(basic.aiEvaluationEnabled).toBe(true);

        const step2 = useSectionDetailsStore.getState();
        expect(step2.status).toBeUndefined();
        expect(step2.testDuration).toEqual({
            entireTestDuration: { checked: true, testDuration: { hrs: '1', min: '30' } },
            sectionWiseDuration: false,
            questionWiseDuration: false,
        });
        expect(step2.section).toBe(sections);
    });
});
