import { useTranslation } from 'react-i18next';
import { Section } from '@/types/assessments/assessment-steps';
import { OfflineResponseState } from '../-utils/types';

interface QuestionItem {
    question_id: string;
}

interface QuestionNavigatorProps {
    sections: Section[];
    questionsMap: Record<string, QuestionItem[]>;
    currentSectionId: string;
    currentQuestionIndex: number;
    responses: OfflineResponseState;
    onSelectSection: (sectionId: string) => void;
    onSelectQuestion: (sectionId: string, index: number) => void;
}

export const QuestionNavigator = ({
    sections,
    questionsMap,
    currentSectionId,
    currentQuestionIndex,
    responses,
    onSelectSection,
    onSelectQuestion,
}: QuestionNavigatorProps) => {
    const { t } = useTranslation('assessmentQuestionNavigator');

    return (
        <div className="flex flex-col gap-4">
            {/* Section Tabs */}
            <div className="flex flex-wrap gap-2">
                {sections.map((section) => (
                    <button
                        key={section.id}
                        onClick={() => onSelectSection(section.id)}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                            currentSectionId === section.id
                                ? 'bg-primary-500 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    >
                        {section.name}
                    </button>
                ))}
            </div>

            {/* Question Number Grid */}
            <div className="flex flex-wrap gap-2">
                {questionsMap[currentSectionId]?.map(
                    (question: QuestionItem, index: number) => {
                        const hasResponse =
                            (responses[question.question_id]?.selectedOptionIds?.length ?? 0) > 0;
                        const isCurrent =
                            currentSectionId === currentSectionId &&
                            currentQuestionIndex === index;

                        return (
                            <button
                                key={question.question_id}
                                onClick={() => onSelectQuestion(currentSectionId, index)}
                                className={`flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors ${
                                    isCurrent
                                        ? 'bg-primary-500 text-white'
                                        : hasResponse
                                          ? 'bg-green-100 text-green-800 border border-green-300'
                                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                {index + 1}
                            </button>
                        );
                    }
                )}
            </div>

            {/* Legend */}
            <div className="flex gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded bg-primary-500" />{' '}
                    {t('legend.current')}
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded border border-green-300 bg-green-100" />{' '}
                    {t('legend.answered')}
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded bg-gray-100" />{' '}
                    {t('legend.unanswered')}
                </span>
            </div>
        </div>
    );
};
