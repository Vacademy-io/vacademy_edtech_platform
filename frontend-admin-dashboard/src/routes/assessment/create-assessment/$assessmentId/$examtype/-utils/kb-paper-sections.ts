/**
 * A generated knowledge-base paper → the Step 2 "sections" of an assessment.
 *
 * Two places hand a KB paper to the assessment wizard: the "build the whole
 * assessment" dialog inside Step 2, and "Save & create offline test" on the
 * paper builder, which sends the teacher into a Manual Upload Exam. Both need
 * the same thing — sections that follow the plan's rows, each question placed
 * in the row it was written for, marks from the row the teacher approved — so
 * the shaping lives here and the two callers stay thin.
 */
import type { z } from 'zod';
import type { Blueprint, RawPaperQuestion } from '@/routes/knowledge-base/-types/paper';
import type { MyQuestion } from '@/types/assessments/question-paper-form';
import sectionDetailsSchema from './section-details-schema';
import { calculateTotalMarks } from './helper';
import { useBasicInfoStore } from './zustand-global-states/step1-basic-info';
import { useSectionDetailsStore } from './zustand-global-states/step2-add-questions';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;
export type KbPaperSection = SectionFormType['section'][number];

/**
 * Sections come from the blueprint ROWS, and each question is placed in the row it
 * was written for (kb_meta.row_id). Rows are grouped by their section name so a plan
 * with three rows in "Section A" produces one section, not three.
 *
 * `storedQuestions` are the questions as read back from the question bank — a
 * section refers to questions by id, and they only have ids once stored. They
 * come back in the order they were sent, which is the order of the paper's
 * questions, and `rawQuestions` is paired with that positionally.
 */
export const sectionsFromKbPaper = (
    blueprint: Blueprint,
    rawQuestions: RawPaperQuestion[],
    storedQuestions: MyQuestion[],
    /** Numbers unnamed sections from here ("Section 3" when two already exist). */
    existingSectionCount = 0
): KbPaperSection[] => {
    const rowIdByIndex = rawQuestions.map((raw) => raw.kb_meta?.row_id ?? '');
    const rowsById = new Map(blueprint.rows.map((row) => [row.id, row]));

    // Preserve the plan's section order rather than whatever order the questions
    // happen to come back in.
    const sectionOrder: string[] = [];
    blueprint.rows.forEach((row) => {
        if (!sectionOrder.includes(row.section)) sectionOrder.push(row.section);
    });

    const bySection = new Map<string, MyQuestion[]>();
    storedQuestions.forEach((question, i) => {
        const row = rowsById.get(rowIdByIndex[i] ?? '');
        const sectionName = row?.section ?? blueprint.title;
        if (!sectionOrder.includes(sectionName)) sectionOrder.push(sectionName);
        const bucket = bySection.get(sectionName) ?? [];
        bucket.push(question);
        bySection.set(sectionName, bucket);
    });

    return sectionOrder
        .filter((sectionName) => (bySection.get(sectionName) ?? []).length > 0)
        .map((sectionName, offset) => {
            const sectionQuestions = bySection.get(sectionName) ?? [];
            const firstRow = blueprint.rows.find((r) => r.section === sectionName);
            const marksEach = String(firstRow?.marks_each ?? 1);
            const adaptive = sectionQuestions.map((question) => ({
                questionId: question.questionId,
                questionName: question.questionName,
                questionType: question.questionType,
                // The per-question mark comes from the row the teacher approved.
                questionMark: marksEach,
                questionPenalty: '0',
                ...(question.questionType === 'MCQM' && {
                    correctOptionIdsCnt: question?.multipleChoiceOptions?.filter(
                        (item) => item.isSelected
                    ).length,
                }),
                questionDuration: { hrs: '0', min: '0' },
                parentRichText: question.parentRichTextContent,
            }));

            return {
                sectionId: '',
                sectionName: sectionName || `Section ${existingSectionCount + offset + 1}`,
                questionPaperTitle: '',
                subject: '',
                yearClass: '',
                uploaded_question_paper: null,
                question_duration: { hrs: '0', min: '0' },
                section_description: firstRow?.instruction ?? '',
                section_duration: { hrs: '0', min: '0' },
                marks_per_question: marksEach,
                total_marks: String(calculateTotalMarks(adaptive)),
                negative_marking: { checked: false, value: '0' },
                partial_marking: false,
                cutoff_marks: { checked: false, value: '0' },
                problem_randomization: false,
                adaptive_marking_for_each_question: adaptive,
            };
        });
};

/**
 * A section with nothing in it yet — no questions, no paper, no description —
 * such as the blank one Step 2 opens with. Generated sections should take its
 * place, not sit under an empty "Section 1" that then blocks Next (a section
 * with no questions fails the step's own check, and nothing on screen says
 * which one). Deliberately not keyed on the default name, which is localised.
 */
export const isUntouchedSection = (section: KbPaperSection): boolean =>
    section.adaptive_marking_for_each_question.length === 0 &&
    !section.uploaded_question_paper &&
    !section.section_description;

// ---- Offline test hand-off ---------------------------------------------------

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/**
 * The paper as a file-attachment block in the instructions rich text — the
 * shape the Step 1 editor's attachment node parses (`a[data-attachment]`) and
 * re-emits with its own chip styling, and the shape the learner's instruction
 * page lifts out of the HTML into an inline PDF viewer with a download button.
 * That is how the paper reaches the learner without a second upload.
 */
export const paperAttachmentHtml = (fileUrl: string, fileName: string): string =>
    `<a data-attachment="true" href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener noreferrer"` +
    ` name="${escapeHtml(fileName)}" type="application/pdf">` +
    `<span>${escapeHtml(fileName)}</span></a>`;

const formatDuration = (minutes: number): string => {
    if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
    return `${minutes} minutes`;
};

/**
 * Instructions for a learner who will solve the paper on paper and upload the
 * answer sheet. Same header lines institutes already write by hand for offline
 * mocks (name, marks, duration, topics), the paper itself as an attachment when
 * it could be published, and the plan's own general instructions.
 */
export const offlineTestInstructionsHtml = (
    blueprint: Blueprint,
    paperFile: { url: string; fileName: string } | null
): string => {
    const topics = Array.from(new Set(blueprint.rows.map((row) => row.topic.trim())))
        .filter(Boolean)
        .join('; ');
    const lines = [
        `<p><strong>Test Name - ${escapeHtml(blueprint.title)}</strong></p>`,
        `<p><strong>Total Marks - ${blueprint.total_marks}</strong></p>`,
    ];
    if (blueprint.duration_minutes) {
        lines.push(
            `<p><strong>Test duration - ${formatDuration(blueprint.duration_minutes)}</strong></p>`
        );
    }
    if (topics) lines.push(`<p><strong>Topic - ${escapeHtml(topics)}</strong></p>`);
    if (paperFile) {
        lines.push('<p></p>', paperAttachmentHtml(paperFile.url, paperFile.fileName));
    }
    if (blueprint.instructions.length > 0) {
        lines.push(
            '<p></p>',
            `<ol>${blueprint.instructions.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ol>`
        );
    }
    lines.push(
        '<p></p>',
        '<p>Write your answers on paper. When you are done, use <strong>Upload Answer</strong> to submit a clear photo or scan of every page.</p>'
    );
    return lines.join('');
};

/**
 * Pre-fill the assessment wizard (opened as EXAM) from a saved KB paper.
 *
 * The wizard's steps read their initial values from these stores on mount, so
 * seeding them before navigating is what makes Step 1 open with the name and
 * instructions filled and Step 2 open with the sections already built. The
 * teacher then only chooses dates and who sits the test.
 *
 * Both stores are reset first: they outlive an abandoned wizard, and the last
 * half-finished assessment's sections must not be appended to this paper.
 */
export const seedOfflineTestWizard = (input: {
    blueprint: Blueprint;
    sections: KbPaperSection[];
    instructionsHtml: string;
}): void => {
    const minutes = input.blueprint.duration_minutes ?? 0;
    useBasicInfoStore.getState().reset();
    useBasicInfoStore.getState().setBasicInfo({
        testCreation: {
            assessmentName: input.blueprint.title,
            assessmentInstructions: input.instructionsHtml,
        },
        // Learners upload a PDF of their sheet; a teacher or the AI checks it. The
        // AI grades each question against the marking rubric the paper generator
        // saved with it — the reason this hand-off is worth having. Metered per
        // graded question, and the switch stays visible in Step 1 to turn it off.
        resultType: 'MANUAL',
        evaluationType: 'MANUAL',
        submissionType: 'PDF',
        aiEvaluationEnabled: true,
    });
    useSectionDetailsStore.getState().reset();
    useSectionDetailsStore.getState().setSectionDetails({
        testDuration: {
            entireTestDuration: {
                checked: true,
                testDuration: {
                    hrs: String(Math.floor(minutes / 60)),
                    min: String(minutes % 60),
                },
            },
            sectionWiseDuration: false,
            questionWiseDuration: false,
        },
        section: input.sections,
    });
};
