import { useTranslation } from 'react-i18next';
import { WarningCircle } from '@phosphor-icons/react';
import type { AttemptMarking } from '@/services/submission-review/types';
import { releasedWithUnmarked, resultLabel } from '@/services/submission-review/labels';
import { StatusPill } from './StatusPill';

/**
 * "Not released" / "Released" / "Released, changed (update not sent)", plus a ⚠ when the
 * result went out with answers still unmarked (W1 Result column, acceptance 2).
 */
export const ResultView = ({
    marking,
    legacyStatus,
}: {
    marking: AttemptMarking | null | undefined;
    legacyStatus?: string | null;
}) => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    const view = marking?.result ?? (legacyStatus === 'RELEASED' ? 'RELEASED' : 'NOT_RELEASED');
    const label = resultLabel(view);
    const unmarked = releasedWithUnmarked(marking);
    const warning = t('result.releasedWithUnmarked', { count: unmarked });
    return (
        <span className="inline-flex items-center gap-1.5">
            <StatusPill tone={label.tone} className="whitespace-normal py-0.5 text-start">
                {t(label.key)}
            </StatusPill>
            {unmarked > 0 && (
                <span
                    role="img"
                    title={warning}
                    aria-label={warning}
                    className="inline-flex text-warning-600"
                >
                    <WarningCircle size={16} weight="fill" />
                </span>
            )}
        </span>
    );
};
