import { useTranslation } from 'react-i18next';
import { modelAnswerOf } from '../../-utils/paper';
import { AnswerText, CriteriaTable, FeedbackBlock, Foldable, QuestionText, RichText, type CardProps } from './common';

/** W3b: the learner's typed answer, the model answer, the AI's scheme breakdown. */
export const LongAnswerCard = ({ detail, paper, row, outline, currentRubricVersion }: CardProps) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const model = detail.answer.correct_text || modelAnswerOf(detail.auto_evaluation_json ?? paper?.auto_evaluation_json);
    const text = detail.answer.text ?? detail.ai?.extracted_answer ?? null;
    return (
        <div className="flex flex-col gap-4">
            <QuestionText paper={paper} />
            {text ? (
                <AnswerText title={t('card.learnerAnswer')} text={text} />
            ) : (
                <p className="text-body text-neutral-500">{t('card.noAnswer')}</p>
            )}
            {model && (
                <Foldable title={t('card.modelAnswer')}>
                    <RichText content={model} />
                </Foldable>
            )}
            <CriteriaTable
                detail={detail}
                row={row}
                learnerName={outline.learner.name}
                currentRubricVersion={currentRubricVersion}
            />
            <FeedbackBlock feedback={detail.evaluator_feedback ?? detail.ai?.feedback} />
        </div>
    );
};
