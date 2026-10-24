import { Question } from './Question';
import { useEffect, useState } from 'react';
import { getQuestionPaperById } from '../-service/utils';
import { Question as QusetionDto } from '@/types/community/filters/questionDto';
import { useShowAnswer } from '../-store/useShowAnswer';
import { useTranslation } from 'react-i18next';

export function QuestionDisplay({ id }: { id: string }) {
    const { t } = useTranslation('communityQuestionPaperQuestionDisplay');
    const [questions, setQuestions] = useState<QusetionDto[]>();
    const fetchQuestions = async () => {
        const response = await getQuestionPaperById(id);
        setQuestions(response.question_dtolist);
    };
    const { setShowAnswer, showAnswer } = useShowAnswer();
    const toggleAnswer = () => {
        setShowAnswer(!showAnswer);
    };
    useEffect(() => {
        if (id) {
            fetchQuestions();
        }
    }, [id]);
    return (
        <div className="flex flex-1 flex-col">
            <div className="flex flex-row justify-between border-b px-8 py-4">
                <div className="text-h3">{t('questionNumber')}</div>
                <div className="cursor-pointer text-primary-500" onClick={toggleAnswer}>
                    {showAnswer ? t('hideAnswer') : t('showAnswers')}
                </div>
            </div>
            <div className="my-5 ml-5 flex flex-col gap-6">
                {questions?.map((question, idx) => (
                    <Question key={question.id} idx={idx} questionData={question} />
                ))}
            </div>
        </div>
    );
}
