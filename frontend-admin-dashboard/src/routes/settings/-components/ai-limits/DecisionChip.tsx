import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { LimitDecision } from '../../-services/ai-limits-service';

const TONE: Record<string, string> = {
    OK: 'border-success-200 bg-success-50 text-success-700',
    WARN: 'border-warning-200 bg-warning-50 text-warning-700',
    WOULD_BLOCK: 'border-warning-300 bg-warning-100 text-warning-700',
    BLOCK: 'border-danger-200 bg-danger-50 text-danger-700',
    NONE: 'border-neutral-200 bg-neutral-50 text-neutral-600',
    OVERRIDDEN: 'border-neutral-200 bg-white text-neutral-500',
    NOT_ACTIVE: 'border-neutral-200 bg-white text-neutral-500',
};

export function DecisionChip({ decision }: { decision: LimitDecision | string }) {
    const { t } = useTranslation('settingsAiLimits');
    const key = decision in TONE ? decision : 'NONE';
    return (
        <span
            className={cn(
                'inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-caption font-medium',
                TONE[key]
            )}
        >
            {t(`decision.${key}`)}
        </span>
    );
}
