import { useSuspenseQuery } from '@tanstack/react-query';
import { getQuestionDataForSection } from '../-services/assessment-services';
import {
    optionsFromQuestionData,
    type QuestionOptionView,
} from '@/components/common/assessment/question-options-list';

interface QuestionData {
    question_id: string;
    question: {
        content: string;
    };
    question_type: string;
    question_duration: string | number;
    marking_json: string;
    evaluation_json?: string | null;
    // The preview DTO fills options_with_explanation; plain `options` stays empty.
    options?: Array<{ id?: string | null; text?: { content?: string | null } | null }>;
    options_with_explanation?: Array<{
        id?: string | null;
        text?: { content?: string | null } | null;
    }>;
}

export type AdaptiveMarkingOption = QuestionOptionView;

export interface AdaptiveMarking {
    questionId: string;
    questionName: string;
    questionType: string;
    questionMark: string;
    questionPenalty: string;
    questionDuration: {
        hrs: string;
        min: string;
    };
    options?: AdaptiveMarkingOption[];
}

export const useQuestionsForSection = (
    assessmentId: string,
    sectionId: string
): { adaptiveMarking: AdaptiveMarking[]; isLoading: boolean } => {
    const { data: questionsData, isLoading } = useSuspenseQuery(
        getQuestionDataForSection({
            assessmentId,
            sectionIds: sectionId,
        })
    );

    // Map questions to adaptive_marking_for_each_question format
    const adaptiveMarking = (questionsData[sectionId] || []).map(
        (questionData: QuestionData): AdaptiveMarking => {
            const markingJson = questionData.marking_json
                ? JSON.parse(questionData.marking_json)
                : {};
            const options: AdaptiveMarkingOption[] = optionsFromQuestionData(questionData);
            return {
                questionId: questionData.question_id || '',
                options,
                questionName: questionData.question?.content || '',
                questionType: questionData.question_type || '',
                questionMark: markingJson.data?.totalMark || '0',
                questionPenalty: markingJson.data?.negativeMark || '0',
                questionDuration: {
                    hrs:
                        typeof questionData.question_duration === 'number'
                            ? String(Math.floor(questionData.question_duration / 60))
                            : '0',
                    min:
                        typeof questionData.question_duration === 'number'
                            ? String(questionData.question_duration % 60)
                            : '0',
                },
            };
        }
    );

    return { adaptiveMarking, isLoading };
};
