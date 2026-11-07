import { Warning } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface Props {
    evaluationVersion: number | null | undefined;
    currentVersion: number | null | undefined;
    className?: string;
}

/**
 * Shows a warning when the rubric on the assessment has been edited since
 * this evaluation was run. Hidden when versions match or either is null
 * (e.g. LLM-derived rubric, no fixed-test mode).
 */
export function RubricChangedBadge({ evaluationVersion, currentVersion, className }: Props) {
    const { t } = useTranslation('assessmentRubricChangedBadge');
    if (evaluationVersion == null || currentVersion == null) return null;
    if (evaluationVersion === currentVersion) return null;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-caption',
                'bg-warning-50 text-warning-700 border border-warning-300',
                className,
            )}
            title={t('tooltip', { currentVersion, evaluationVersion })}
        >
            <Warning size={14} weight="bold" />
            {t('badgeLabel')}
        </span>
    );
}
