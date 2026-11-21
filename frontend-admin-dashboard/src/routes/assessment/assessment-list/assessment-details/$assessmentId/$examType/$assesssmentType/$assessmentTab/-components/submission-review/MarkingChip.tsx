import { useTranslation } from 'react-i18next';
import { CheckCircle, Circle, CircleHalf, CircleNotch, Minus } from '@phosphor-icons/react';
import type { AttemptMarking } from '@/services/submission-review/types';
import { markingLabel } from '@/services/submission-review/labels';
import { StatusPill } from './StatusPill';

const ICONS = {
    NEEDS_MARKING: <Circle size={10} weight="fill" />,
    AI_CHECKING: <CircleNotch size={12} className="animate-spin" />,
    CHECK_AI: <CircleHalf size={12} weight="fill" />,
    DONE: <CheckCircle size={12} weight="fill" />,
    TOTAL_ONLY: <Minus size={12} />,
    NOT_SUBMITTED: <Minus size={12} />,
} as const;

/** "Needs marking (1)", "Check AI marks (2)", "Done"… (W1 Marking column). */
export const MarkingChip = ({ marking }: { marking: AttemptMarking }) => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    const label = markingLabel(marking.marking, marking.counts);
    return (
        <StatusPill tone={label.tone} icon={ICONS[marking.marking]}>
            {t(label.key, label.params)}
        </StatusPill>
    );
};
