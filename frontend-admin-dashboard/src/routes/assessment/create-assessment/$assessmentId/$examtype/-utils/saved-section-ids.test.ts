import { describe, expect, it } from 'vitest';
import { classifySections, convertStep2Data } from './helper';
import {
    hasUnrecordedSavedSections,
    resolveSavedSectionIds,
    snapshotFormValues,
    withoutSectionIds,
} from './saved-section-ids';

type Step2Data = Parameters<typeof convertStep2Data>[0];
type Step2Section = Step2Data['section'][number];
type Step2Question = Step2Section['adaptive_marking_for_each_question'][number];

const question = (questionId: string, mark = '5'): Step2Question => ({
    questionId,
    questionName: `Question ${questionId}`,
    questionType: 'CBE_RESPONSE',
    questionMark: mark,
    questionPenalty: '0',
    questionDuration: { hrs: '0', min: '0' },
});

const section = (name: string, questionIds: string[], sectionId = ''): Step2Section => ({
    sectionId,
    sectionName: name,
    questionPaperTitle: '',
    subject: '',
    yearClass: '',
    uploaded_question_paper: null,
    question_duration: { hrs: '0', min: '0' },
    section_description: '',
    section_duration: { hrs: '0', min: '0' },
    marks_per_question: '5',
    total_marks: String(questionIds.length * 5),
    negative_marking: { checked: false, value: '0' },
    partial_marking: false,
    cutoff_marks: { checked: false, value: '0' },
    problem_randomization: false,
    adaptive_marking_for_each_question: questionIds.map((id) => question(id)),
});

const form = (sections: Step2Section[]): Step2Data => ({
    status: 'INCOMPLETE',
    testDuration: {
        entireTestDuration: { checked: true, testDuration: { hrs: '1', min: '0' } },
        sectionWiseDuration: false,
        questionWiseDuration: false,
    },
    section: sections,
});

/** What handlePostStep2Data sends for a save of `data` diffed against `oldData`. */
const diff = (oldData: Step2Data, data: Step2Data) =>
    classifySections(convertStep2Data(oldData), convertStep2Data(data));

/** The server after an add: each added section gets an id and keeps the order it was sent with. */
const serverAfterAdd = (sent: ReturnType<typeof diff>, ids: string[]) =>
    sent.added_sections.map((s, i) => ({ id: ids[i]!, section_order: s.section_order }));

/** The wizard after a save: ids written into the form, the saved state is the new baseline. */
const afterSave = (data: Step2Data, serverSections: { id: string; section_order: number }[]) => {
    const ids = resolveSavedSectionIds(
        data.section.map((s) => s.sectionId),
        serverSections
    );
    const saved = snapshotFormValues({
        ...data,
        section: data.section.map((s, i) => ({ ...s, sectionId: ids[i] || s.sectionId })),
    });
    return saved;
};

describe('resolveSavedSectionIds', () => {
    it('gives each new section the id saved at its position', () => {
        expect(
            resolveSavedSectionIds(
                ['', ''],
                [
                    { id: 'sec-b', section_order: 2 },
                    { id: 'sec-a', section_order: 1 },
                ]
            )
        ).toEqual(['sec-a', 'sec-b']);
    });

    it('keeps ids the form already has and places only the new section', () => {
        expect(
            resolveSavedSectionIds(
                ['sec-a', '', 'sec-b'],
                [
                    { id: 'sec-a', section_order: 1 },
                    { id: 'sec-b', section_order: 2 }, // not re-sent, so its order is stale
                    { id: 'sec-c', section_order: 2 },
                ]
            )
        ).toEqual(['sec-a', 'sec-c', 'sec-b']);
    });

    it('pairs in order when positions do not place them but the counts agree', () => {
        expect(
            resolveSavedSectionIds(
                ['', ''],
                [
                    { id: 'sec-y', section_order: 7 },
                    { id: 'sec-x', section_order: 5 },
                ]
            )
        ).toEqual(['sec-x', 'sec-y']);
    });

    it('leaves a section blank rather than guessing when the server holds more new sections', () => {
        expect(
            resolveSavedSectionIds(
                [''],
                [
                    { id: 'sec-x', section_order: 3 },
                    { id: 'sec-y', section_order: 4 },
                ]
            )
        ).toEqual(['']);
    });

    it('never hands a removed section’s id to a new one', () => {
        // The admin removed saved section "sec-a" and added a new one in the form.
        expect(
            resolveSavedSectionIds(
                ['sec-b', ''],
                [
                    { id: 'sec-a', section_order: 1 },
                    { id: 'sec-b', section_order: 2 },
                ],
                ['sec-a', 'sec-b']
            )
        ).toEqual(['sec-b', '']);
        expect(
            hasUnrecordedSavedSections(['sec-b', ''], [{ id: 'sec-a' }, { id: 'sec-b' }], ['sec-a'])
        ).toBe(false);
    });

    it('reports saved sections the form has not recorded', () => {
        expect(hasUnrecordedSavedSections(['', ''], [{ id: 'sec-a' }, { id: 'sec-b' }])).toBe(true);
        expect(hasUnrecordedSavedSections(['sec-a'], [{ id: 'sec-a' }])).toBe(false);
        expect(hasUnrecordedSavedSections([''], [])).toBe(false);
        expect(hasUnrecordedSavedSections([''], undefined)).toBe(false);
    });
});

describe('create wizard: saving step 2 again', () => {
    // FR Mock 1 (Prepper, 2026-11-18): saved, back from step 3, DEFAULT renamed to
    // Section B, saved again -> four sections and double the marks.
    const firstForm = form([section('Section A', ['q1', 'q2']), section('DEFAULT', ['q3'])]);
    const blankBaseline = form([section('Section 1', [])]);

    it('first save adds every section with its questions', () => {
        const sent = diff(blankBaseline, firstForm);
        expect(sent.added_sections.map((s) => s.section_name)).toEqual(['Section A', 'DEFAULT']);
        expect(sent.updated_sections).toEqual([]);
        expect(sent.deleted_sections).toEqual([]);
    });

    it('the old behaviour: without the saved ids a second save adds every section again', () => {
        const renamed = form([section('Section A', ['q1', 'q2']), section('Section B', ['q3'])]);
        // Baseline = the store after the first save, ids still blank.
        const sent = diff(firstForm, renamed);
        expect(sent.added_sections).toHaveLength(2);
    });

    it('with the saved ids a rename is one update and no question moves', () => {
        const first = diff(blankBaseline, firstForm);
        const saved = afterSave(firstForm, serverAfterAdd(first, ['sec-a', 'sec-b']));
        expect(saved.section.map((s) => s.sectionId)).toEqual(['sec-a', 'sec-b']);

        // Back on step 2 the form opens from the store copy (== saved), then a rename.
        const edited = snapshotFormValues(saved);
        edited.section[1]!.sectionName = 'Section B';

        const sent = diff(saved, edited);
        expect(sent.added_sections).toEqual([]);
        expect(sent.deleted_sections).toEqual([]);
        expect(sent.updated_sections).toHaveLength(1);
        expect(sent.updated_sections[0]!.section_id).toBe('sec-b');
        expect(sent.updated_sections[0]!.section_name).toBe('Section B');
        expect(sent.updated_sections[0]!.question_and_marking).toEqual([]);
    });

    it('saving unchanged sends nothing', () => {
        const first = diff(blankBaseline, firstForm);
        const saved = afterSave(firstForm, serverAfterAdd(first, ['sec-a', 'sec-b']));
        const sent = diff(saved, snapshotFormValues(saved));
        expect(sent).toEqual({ added_sections: [], updated_sections: [], deleted_sections: [] });
    });

    it('a question added to a saved section is the only question sent', () => {
        const first = diff(blankBaseline, firstForm);
        const saved = afterSave(firstForm, serverAfterAdd(first, ['sec-a', 'sec-b']));
        const edited = snapshotFormValues(saved);
        edited.section[0]!.adaptive_marking_for_each_question.push(question('q9'));

        const sent = diff(saved, edited);
        expect(sent.added_sections).toEqual([]);
        expect(sent.updated_sections).toHaveLength(1);
        expect(
            sent.updated_sections[0]!.question_and_marking.map((q) => [
                q.question_id,
                q.is_added,
                q.is_updated,
                q.is_deleted,
            ])
        ).toEqual([['q9', true, false, false]]);
    });

    it('a section added after the first save is the only section added, and gets its id', () => {
        const first = diff(blankBaseline, firstForm);
        const saved = afterSave(firstForm, serverAfterAdd(first, ['sec-a', 'sec-b']));
        const edited = snapshotFormValues(saved);
        edited.section.push(section('Section C', ['q4']));

        const sent = diff(saved, edited);
        expect(sent.added_sections.map((s) => [s.section_name, s.section_order])).toEqual([
            ['Section C', 3],
        ]);
        expect(sent.updated_sections).toEqual([]);

        const server = [
            { id: 'sec-a', section_order: 1 },
            { id: 'sec-b', section_order: 2 },
            { id: 'sec-c', section_order: 3 },
        ];
        const savedAgain = afterSave(edited, server);
        expect(savedAgain.section.map((s) => s.sectionId)).toEqual(['sec-a', 'sec-b', 'sec-c']);
        expect(diff(savedAgain, snapshotFormValues(savedAgain)).added_sections).toEqual([]);
    });

    it('a removed saved section is sent as deleted, not re-added', () => {
        const first = diff(blankBaseline, firstForm);
        const saved = afterSave(firstForm, serverAfterAdd(first, ['sec-a', 'sec-b']));
        const edited = snapshotFormValues(saved);
        edited.section.splice(0, 1);

        const sent = diff(saved, edited);
        expect(sent.added_sections).toEqual([]);
        expect(sent.deleted_sections.map((s) => s.section_id)).toEqual(['sec-a']);
    });

    it('a section that moves up is sent with its new order, so no two sections share one', () => {
        const first = diff(blankBaseline, firstForm);
        const saved = afterSave(firstForm, serverAfterAdd(first, ['sec-a', 'sec-b']));
        const edited = snapshotFormValues(saved);
        edited.section.splice(0, 1);
        edited.section.push(section('Section C', ['q4']));

        const sent = diff(saved, edited);
        expect(sent.deleted_sections.map((s) => s.section_id)).toEqual(['sec-a']);
        expect(sent.updated_sections.map((s) => [s.section_id, s.section_order])).toEqual([
            ['sec-b', 1],
        ]);
        expect(sent.updated_sections[0]!.question_and_marking).toEqual([]);
        expect(sent.added_sections.map((s) => [s.section_name, s.section_order])).toEqual([
            ['Section C', 2],
        ]);
    });
});

describe('withoutSectionIds / snapshotFormValues', () => {
    it('drops ids saved to another assessment', () => {
        expect(
            withoutSectionIds([section('A', [], 'old-1'), section('B', [], 'old-2')]).map(
                (s) => s.sectionId
            )
        ).toEqual(['', '']);
    });

    it('detaches the baseline from later edits of the form', () => {
        const values = form([section('A', ['q1'], 'sec-a')]);
        const baseline = snapshotFormValues(values);
        values.section[0]!.adaptive_marking_for_each_question[0]!.questionMark = '10';
        expect(baseline.section[0]!.adaptive_marking_for_each_question[0]!.questionMark).toBe('5');
    });
});
