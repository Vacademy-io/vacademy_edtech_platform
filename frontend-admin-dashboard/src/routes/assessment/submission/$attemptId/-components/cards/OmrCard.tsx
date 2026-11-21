import { useTranslation } from 'react-i18next';
import { ObjectiveCard } from './ObjectiveCard';
import { LongAnswerCard } from './LongAnswerCard';
import { isObjectiveType } from '@/services/submission-review/marks';
import type { CardProps } from './common';

/**
 * W3f: what the scanner read against the key. Changing the bubbles read stays on the OMR
 * tab ("Fix answers"); the marks themselves can be edited here.
 */
export const OmrCard = (props: CardProps) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    return (
        <div className="flex flex-col gap-3">
            <p className="rounded-md bg-info-50 p-3 text-caption text-info-700">{t('card.omrHint')}</p>
            {isObjectiveType(props.row.question_type) ? <ObjectiveCard {...props} /> : <LongAnswerCard {...props} />}
        </div>
    );
};
