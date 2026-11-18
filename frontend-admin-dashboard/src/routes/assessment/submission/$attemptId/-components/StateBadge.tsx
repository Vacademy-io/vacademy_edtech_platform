import { useTranslation } from 'react-i18next';
import { CheckCircle, Circle, CircleHalf, CircleNotch, MinusCircle, WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { questionStateLabel, TONE_CHIP_CLASSES } from '@/services/submission-review/labels';
import type { QuestionRow } from '@/services/submission-review/types';

const iconFor = (key: string) => {
    switch (key) {
        case 'state.aiChecking':
            return <CircleNotch size={12} className="animate-spin" />;
        case 'state.aiFailed':
            return <WarningCircle size={12} weight="fill" />;
        case 'state.needsMarking':
            return <Circle size={10} weight="fill" />;
        case 'state.aiDraft':
            return <CircleHalf size={12} weight="fill" />;
        case 'state.marked':
            return <CheckCircle size={12} weight="fill" />;
        default:
            return <MinusCircle size={12} />;
    }
};

/** A question's state, plus "Not counted" / "Changed after release" badges (spec §3.2). */
export const StateBadge = ({
    row,
    hideMarked = false,
    className,
}: {
    row: QuestionRow;
    /** Rows that already say "Marked by …" do not need a "Marked" chip as well. */
    hideMarked?: boolean;
    className?: string;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const label = questionStateLabel(row);
    const showState = !(hideMarked && label.key === 'state.marked');
    return (
        <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
            {showState && (
                <span
                    className={cn(
                        'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-caption font-semibold',
                        TONE_CHIP_CLASSES[label.tone]
                    )}
                >
                    {iconFor(label.key)}
                    {t(label.key, label.params)}
                </span>
            )}
            {!row.counted && (
                <span className="inline-flex h-6 items-center rounded-full border border-neutral-200 bg-neutral-50 px-2 text-caption font-medium text-neutral-500">
                    {t('badges.notCounted')}
                </span>
            )}
            {row.changed_after_release && (
                <span className="inline-flex h-6 items-center rounded-full border border-warning-200 bg-warning-50 px-2 text-caption font-medium text-warning-700">
                    {t('badges.changedAfterRelease')}
                </span>
            )}
        </span>
    );
};
