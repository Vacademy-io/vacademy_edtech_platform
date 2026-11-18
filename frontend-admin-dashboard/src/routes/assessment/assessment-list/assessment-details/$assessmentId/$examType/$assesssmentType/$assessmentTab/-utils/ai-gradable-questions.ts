import { useQuery } from '@tanstack/react-query';
import { CBE_QUESTION_TYPE } from '@/components/cbe/types';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';

/**
 * Question types the AI marks on an online test (the backend's
 * TypedAnswerEvaluation.AI_GRADED_TYPES). A CBE answer is never auto-scored, so
 * the AI is the only thing that can mark it; a long answer is marked by the AI
 * when it is asked to.
 */
export const AI_GRADED_QUESTION_TYPES: readonly string[] = ['LONG_ANSWER', CBE_QUESTION_TYPE];

interface QuestionTypeRow {
    question_id?: string | null;
    question_type?: string | null;
    marking_json?: string | null;
}

const markingType = (markingJson: string | null | undefined): string | undefined => {
    if (!markingJson) return undefined;
    try {
        const type = (JSON.parse(markingJson) as { type?: unknown })?.type;
        return typeof type === 'string' ? type : undefined;
    } catch {
        return undefined;
    }
};

const isAiGraded = (type: string | null | undefined) =>
    !!type && AI_GRADED_QUESTION_TYPES.includes(type.toUpperCase());

/**
 * Questions on the paper the AI can mark, from the questions-of-sections payload. A
 * question that sits in two sections counts once: the AI grades (and bills) it once.
 */
export function countAiGradableQuestions(
    questionsBySection: Record<string, QuestionTypeRow[] | null | undefined> | null | undefined
): number {
    if (!questionsBySection) return 0;
    const seen = new Set<string>();
    let count = 0;
    for (const questions of Object.values(questionsBySection)) {
        for (const question of questions ?? []) {
            if (
                !isAiGraded(question?.question_type) &&
                !isAiGraded(markingType(question?.marking_json))
            ) {
                continue;
            }
            const id = question?.question_id;
            if (id) {
                if (seen.has(id)) continue;
                seen.add(id);
            }
            count += 1;
        }
    }
    return count;
}

/**
 * How many questions on this assessment the AI can mark. Reads the same cached
 * details and questions-of-sections queries the details page already makes, so
 * every row of the submissions table shares one request. undefined while loading.
 */
export function useAiGradableQuestionCount({
    assessmentId,
    instituteId,
    enabled = true,
}: {
    assessmentId: string;
    instituteId: string | undefined;
    enabled?: boolean;
}): number | undefined {
    const details = useQuery({
        ...getAssessmentDetails({ assessmentId, instituteId, type: 'EXAM' }),
        enabled: enabled && !!assessmentId,
    });
    const sectionIds = (details.data?.[1]?.saved_data?.sections ?? [])
        .map((section) => section.id)
        .join(',');
    const questions = useQuery({
        ...getQuestionDataForSection({ assessmentId, sectionIds }),
        enabled: enabled && !!assessmentId && sectionIds.length > 0,
    });
    if (!enabled) return undefined;
    if (details.isSuccess && sectionIds.length === 0) return 0;
    if (!questions.isSuccess) return undefined;
    return countAiGradableQuestions(questions.data);
}
