import { useTranslation } from 'react-i18next';
import { CheckCircle, Circle, RadioButton } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { correctOptionIdsOf, optionLetter } from '../../-utils/paper';
import { AnswerText, FeedbackBlock, Heading, QuestionText, RichText, type CardProps } from './common';

/**
 * W3a: the options with the learner's choice and the correct one; numeric / one-word
 * answers as "Answer … · Correct …".
 */
export const ObjectiveCard = ({ detail, paper }: CardProps) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const chosen = new Set(detail.answer.chosen_option_ids);
    const correctIds = detail.answer.correct_option_ids.length
        ? detail.answer.correct_option_ids
        : correctOptionIdsOf(paper);
    const correct = new Set(correctIds);
    const options = paper?.options_with_explanation ?? [];

    return (
        <div className="flex flex-col gap-4">
            <QuestionText paper={paper} />
            {options.length > 0 ? (
                <div>
                    <Heading>{t('card.options')}</Heading>
                    <ul className="flex flex-col gap-1.5">
                        {options.map((opt, i) => {
                            const isChosen = chosen.has(opt.id);
                            const isCorrect = correct.has(opt.id);
                            return (
                                <li
                                    key={opt.id}
                                    className={cn(
                                        'flex items-start gap-2 rounded-md border px-3 py-2',
                                        isCorrect
                                            ? 'border-success-200 bg-success-50'
                                            : isChosen
                                              ? 'border-danger-200 bg-danger-50'
                                              : 'border-neutral-200'
                                    )}
                                >
                                    <span className="mt-0.5 shrink-0 text-neutral-500">
                                        {isChosen ? <RadioButton size={16} weight="fill" /> : <Circle size={16} />}
                                    </span>
                                    <span className="w-5 shrink-0 font-semibold text-neutral-600">{optionLetter(i)}</span>
                                    <div className="min-w-0 flex-1">
                                        <RichText content={opt.text?.content} />
                                    </div>
                                    <span className="flex shrink-0 flex-col items-end gap-0.5 text-caption">
                                        {isChosen && <span className="font-medium text-neutral-700">{t('card.learnerChoice')}</span>}
                                        {isCorrect && (
                                            <span className="inline-flex items-center gap-1 font-medium text-success-700">
                                                <CheckCircle size={12} weight="fill" />
                                                {t('card.correct')}
                                            </span>
                                        )}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                    {chosen.size === 0 && <p className="mt-2 text-caption text-neutral-500">{t('card.noOptionChosen')}</p>}
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                    <AnswerText title={t('card.learnerAnswer')} text={detail.answer.text ?? t('card.noAnswer')} />
                    <AnswerText title={t('card.correctAnswer')} text={detail.answer.correct_text} />
                </div>
            )}
            <FeedbackBlock feedback={detail.evaluator_feedback} />
        </div>
    );
};
