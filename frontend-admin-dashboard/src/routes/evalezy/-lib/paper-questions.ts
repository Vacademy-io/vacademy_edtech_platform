import {
    optionsFromQuestionData,
    type QuestionOptionView,
} from '@/components/common/assessment/question-options-list';
import type { CopyCheckCriteriaQuestion } from '@/services/copy-check-criteria';
import type { QuestionData, QuestionDataObject } from '@/types/assessments/assessment-steps';
import { numericNegativeMarkingPercentage } from '@/lib/negative-marking';

export interface PaperSection {
    id?: string;
    name?: string;
    section_order?: number;
    total_marks?: number | null;
}

export interface PaperQuestion {
    id: string;
    number: number;
    html: string;
    marks: number;
    negativeMarks: number;
    options: QuestionOptionView[];
    /** The question as the AI check knows it; absent until the criteria have loaded. */
    criteria?: CopyCheckCriteriaQuestion;
    sectionId: string;
    /** As stored, for writing the marks back without losing the rest of the scheme. */
    questionType: string;
    markingJson: string | null;
    order: number;
    durationMin: number;
}

export interface PaperSectionView {
    id: string;
    name: string;
    totalMarks: number | null;
    questions: PaperQuestion[];
}

/** {"data":{"totalMark":"5","negativeMark":"1"}}; bad or missing JSON reads as 0 marks. */
const readMarking = (markingJson?: string | null): { marks: number; negativeMarks: number } => {
    try {
        const data = markingJson ? JSON.parse(markingJson)?.data : null;
        return {
            marks: Number(data?.totalMark) || 0,
            negativeMarks: Number(data?.negativeMark) || 0,
        };
    } catch {
        return { marks: 0, negativeMarks: 0 };
    }
};

const byOrder = (a?: number | null, b?: number | null) =>
    (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);

/**
 * The paper in the order the copy check numbers it: sections by order, questions by
 * order within them. Numbers and marks come from the check when it has them, so the
 * card matches what the AI marks by.
 */
export const buildPaperSections = (
    sections: PaperSection[],
    questionsBySection: QuestionDataObject | undefined,
    criteria: CopyCheckCriteriaQuestion[] = []
): PaperSectionView[] => {
    const criteriaById = new Map(criteria.map((q) => [q.question_id, q]));
    let running = 0;
    return [...sections]
        .sort((a, b) => byOrder(a.section_order, b.section_order))
        .map((section) => {
            const raw: QuestionData[] = section.id ? questionsBySection?.[section.id] ?? [] : [];
            const questions = [...raw]
                .sort((a, b) => byOrder(a.question_order, b.question_order))
                .map((q): PaperQuestion => {
                    running += 1;
                    const known = criteriaById.get(q.question_id);
                    const { marks, negativeMarks } = readMarking(q.marking_json);
                    return {
                        id: q.question_id,
                        number: known?.number ?? running,
                        html: q.question?.content ?? '',
                        marks: known && known.max_marks > 0 ? known.max_marks : marks,
                        negativeMarks,
                        options: optionsFromQuestionData(q),
                        criteria: known,
                        sectionId: section.id ?? '',
                        questionType: q.question_type,
                        markingJson: q.marking_json ?? null,
                        order: q.question_order,
                        durationMin: Number(q.question_duration) || 0,
                    };
                });
            return {
                id: section.id ?? '',
                name: section.name ?? '',
                totalMarks: section.total_marks ?? null,
                questions,
            };
        })
        .filter((section) => section.questions.length > 0);
};

/** The stored scheme with new marks; everything else in it (negative marks, type) is kept. */
export const markingWithMarks = (
    markingJson: string | null,
    questionType: string,
    marks: number
): string => {
    let scheme: { type?: string; data?: Record<string, unknown> } = {};
    try {
        scheme = (markingJson && JSON.parse(markingJson)) || {};
    } catch {
        scheme = {};
    }
    const type = scheme.type ?? questionType;
    const data: Record<string, unknown> = {
        negativeMark: '0',
        ...scheme.data,
        totalMark: String(marks),
    };
    // NUMERIC is graded as negativeMark * negativeMarkingPercentage / 100, so a stored
    // penalty only takes full effect at 100 (see lib/negative-marking).
    if (type === 'NUMERIC') {
        data.negativeMarkingPercentage = numericNegativeMarkingPercentage(data.negativeMark);
    }
    return JSON.stringify({ ...scheme, type, data });
};

/**
 * The section's total after one question's marks change. A total that differs from the sum of
 * its questions is deliberate ("answer any N of M"), so it is left for the teacher.
 */
export const sectionTotalWithMarks = (
    section: Pick<PaperSectionView, 'totalMarks' | 'questions'>,
    questionId: string,
    marks: number
): number | null => {
    if (section.totalMarks == null) return null;
    const sum = (read: (q: PaperQuestion) => number) =>
        section.questions.reduce((total, q) => total + read(q), 0);
    const stored = (q: PaperQuestion) => readMarking(q.markingJson).marks;
    if (Math.abs(sum(stored) - section.totalMarks) > 0.01) return section.totalMarks;
    const next = sum((q) => (q.id === questionId ? marks : stored(q)));
    return Math.round(next * 100) / 100;
};
