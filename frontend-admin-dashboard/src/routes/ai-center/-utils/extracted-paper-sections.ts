/**
 * A digitised paper (Vsmart Extract) → the Step 2 sections of an assessment.
 *
 * The paper's own sections become sections here, in the paper's order, each
 * question in the section it was printed under, with the marks and negative
 * marks the paper states (per question, per section or for the whole paper —
 * settled by the backend into each question's `questionMark` / `questionPenalty`).
 *
 * Questions only have ids once stored in the question bank; `storedQuestions`
 * is what came back from it, in the order the preview sent them, and
 * `previewQuestions` (the preview form's rows, which carry the section name and
 * marks) is paired with it positionally — by name when the counts differ.
 */
import type {
    AIExtractionSummary,
    AIPaperSection,
} from '@/types/ai/generate-assessment/generate-complete-assessment';
import type { MyQuestion } from '@/types/assessments/question-paper-form';
import type { KbPaperSection } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/kb-paper-sections';
import { calculateTotalMarks } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/helper';

/** A row of a section's marking table; `parentRichText` rides along for the quiz context, as the preview always sent it. */
export type SectionQuestionRow = KbPaperSection['adaptive_marking_for_each_question'][number] & {
    parentRichText?: string | null;
};

const positive = (value: string | undefined): string => (value && Number(value) > 0 ? value : '');

/** What a question is worth when neither the paper nor the bank says: one mark, so the paper is usable as it lands. */
export const DEFAULT_MARK = '1';

/** A duration field the teacher has not filled in yet. */
export const isBlankDuration = (d: { hrs?: string; min?: string } | undefined): boolean =>
    !d || ((!d.hrs || Number(d.hrs) === 0) && (!d.min || Number(d.min) === 0));

/** {hrs, min} for the wizard's duration fields; blank when the paper says nothing. */
export const durationFields = (minutes: number | null | undefined): { hrs: string; min: string } =>
    minutes && minutes > 0
        ? { hrs: String(Math.floor(minutes / 60)), min: String(minutes % 60) }
        : { hrs: '0', min: '0' };

/**
 * A stored question as one row of a section's marking table, marks from the
 * paper when it has them. `defaultMark` fills in when neither the paper nor
 * the bank has a mark — the digitising flow passes one so no question lands
 * worth nothing; the generating flows pass none and keep the old behaviour.
 */
export const sectionRowFor = (
    stored: MyQuestion,
    fromPaper: MyQuestion | undefined,
    defaultMark = ''
): SectionQuestionRow => ({
    ...stored,
    questionId: stored.questionId,
    questionName: stored.questionName,
    questionType: stored.questionType,
    questionMark: positive(fromPaper?.questionMark) || stored.questionMark || defaultMark,
    questionPenalty: positive(fromPaper?.questionPenalty) || stored.questionPenalty,
    ...(stored.questionType === 'MCQM' && {
        correctOptionIdsCnt: stored?.multipleChoiceOptions?.filter((item) => item.isSelected)
            .length,
    }),
    questionDuration: {
        hrs: stored.questionDuration.hrs,
        min: stored.questionDuration.min,
    },
    parentRichText: stored.parentRichTextContent,
});

/** The preview row for each stored question: by position when the counts match, else by text. */
export const pairWithPreview = (
    storedQuestions: MyQuestion[],
    previewQuestions: MyQuestion[]
): Array<MyQuestion | undefined> => {
    if (storedQuestions.length === previewQuestions.length) {
        return storedQuestions.map((_, i) => previewQuestions[i]);
    }
    const byName = new Map(previewQuestions.map((q) => [q.questionName, q]));
    return storedQuestions.map((q) => byName.get(q.questionName));
};

/**
 * Whether the paper is to be split — the teacher's choice in the preview
 * when they made one there, else what they answered at upload — and has at
 * least two sections to split into.
 */
export const wantsSections = (
    summary: AIExtractionSummary | null | undefined,
    choice?: 'split' | 'single' | null
): boolean =>
    (choice ?? summary?.section_mode) === 'split' && (summary?.sections?.length ?? 0) >= 2;

/**
 * A section with no questions and no uploaded paper — the blank one Step 2
 * opens with, whatever the teacher may have typed into its description or
 * name. The paper's sections take its place; a description it had is kept
 * on the first of them when the paper prints no instruction of its own.
 */
export const isEmptySection = (section: {
    adaptive_marking_for_each_question: unknown[];
    uploaded_question_paper?: unknown;
}): boolean =>
    section.adaptive_marking_for_each_question.length === 0 && !section.uploaded_question_paper;

const uniform = (values: string[]): string | null =>
    values.length > 0 && values.every((v) => v === values[0]) ? values[0]! : null;

export const sectionsFromExtractedPaper = (
    summary: AIExtractionSummary,
    previewQuestions: MyQuestion[],
    storedQuestions: MyQuestion[],
    /** Numbers unnamed sections from here ("Section 3" when two already exist). */
    existingSectionCount = 0
): KbPaperSection[] => {
    const paired = pairWithPreview(storedQuestions, previewQuestions);
    const paperSections: AIPaperSection[] = summary.sections ?? [];

    // The paper's order; a question whose section the paper did not name goes
    // after the named ones rather than vanishing.
    const order: string[] = paperSections.map((s) => s.name);
    const bySection = new Map<string, SectionQuestionRow[]>();
    storedQuestions.forEach((stored, i) => {
        const fromPaper = paired[i];
        const name = fromPaper?.sectionName || '';
        if (!order.includes(name)) order.push(name);
        const bucket = bySection.get(name) ?? [];
        bucket.push(sectionRowFor(stored, fromPaper, DEFAULT_MARK));
        bySection.set(name, bucket);
    });

    return order
        .filter((name) => (bySection.get(name) ?? []).length > 0)
        .map((name, offset) => {
            const rows = bySection.get(name) ?? [];
            const paperSection = paperSections.find((s) => s.name === name);
            const marksEach = uniform(rows.map((r) => r.questionMark));
            const penaltyEach = uniform(rows.map((r) => r.questionPenalty));
            return {
                sectionId: '',
                sectionName: name || `Section ${existingSectionCount + offset + 1}`,
                questionPaperTitle: '',
                subject: '',
                yearClass: '',
                uploaded_question_paper: null,
                question_duration: { hrs: '0', min: '0' },
                section_description: paperSection?.instruction ?? '',
                section_duration: durationFields(paperSection?.duration_minutes),
                marks_per_question: marksEach ?? '',
                total_marks: String(calculateTotalMarks(rows)),
                negative_marking: {
                    checked: Number(penaltyEach) > 0,
                    value: penaltyEach && Number(penaltyEach) > 0 ? penaltyEach : '0',
                },
                partial_marking: false,
                cutoff_marks: { checked: false, value: '0' },
                problem_randomization: false,
                adaptive_marking_for_each_question: rows,
            };
        });
};
