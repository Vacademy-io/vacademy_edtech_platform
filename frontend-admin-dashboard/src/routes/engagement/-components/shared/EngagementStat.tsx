import type { ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * One stat tile for the engagement insight screens (tracking, overview, plan card):
 * a label, a value, and an optional hint, icon and progress bar.
 *
 * Tone carries meaning only. Callers pass `neutral` for a zero or a not-yet-meaningful
 * number (nothing has closed yet), so a green "0" never reads as good news.
 */

export type EngagementStatTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE_TILE: Record<EngagementStatTone, string> = {
    neutral: 'border-neutral-200 bg-white',
    success: 'border-success-200 bg-success-50',
    warning: 'border-warning-200 bg-warning-50',
    danger: 'border-danger-200 bg-danger-50',
    info: 'border-info-200 bg-info-50',
};

const TONE_ICON: Record<EngagementStatTone, string> = {
    neutral: 'text-neutral-500',
    success: 'text-success-600',
    warning: 'text-warning-600',
    danger: 'text-danger-600',
    info: 'text-info-600',
};

const TONE_BAR: Record<EngagementStatTone, string> = {
    neutral: 'bg-primary-500',
    success: 'bg-success-500',
    warning: 'bg-warning-500',
    danger: 'bg-danger-500',
    info: 'bg-info-500',
};

export interface EngagementStatProps {
    label: string;
    /** Pre-formatted (locale digits, "1 / 2", "67%"). */
    value: ReactNode;
    hint?: ReactNode;
    tone?: EngagementStatTone;
    icon?: Icon;
    /** 0–1; draws a thin bar under the value. */
    progress?: number | null;
    /** Accessible name for the bar, e.g. "50% of learners done". */
    progressLabel?: string;
    loading?: boolean;
    /** Makes the whole tile a button (e.g. a filter). */
    onClick?: () => void;
    /** For a clickable tile: whether its filter is on. */
    selected?: boolean;
    className?: string;
}

export function EngagementStat({
    label,
    value,
    hint,
    tone = 'neutral',
    icon: IconComponent,
    progress,
    progressLabel,
    loading = false,
    onClick,
    selected,
    className,
}: EngagementStatProps) {
    const percent =
        progress == null || !Number.isFinite(progress)
            ? null
            : Math.round(Math.min(1, Math.max(0, progress)) * 100);

    const body = (
        <>
            <div className="flex items-center gap-1.5">
                {IconComponent && (
                    <IconComponent
                        size={14}
                        weight="bold"
                        className={TONE_ICON[tone]}
                        aria-hidden
                    />
                )}
                <p className="truncate text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {label}
                </p>
            </div>
            {loading ? (
                <Skeleton className="mt-1 h-7 w-16" />
            ) : (
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900">
                    {value}
                </p>
            )}
            {percent !== null && !loading && (
                <div
                    className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-label={progressLabel ?? label}
                >
                    <div
                        className={cn('h-full rounded-full transition-all', TONE_BAR[tone])}
                        // Width is data, not styling: the one value Tailwind can't express.
                        style={{ width: `${percent}%` }} // design-lint-ignore: data-driven width
                    />
                </div>
            )}
            {hint && !loading && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
        </>
    );

    const tileClass = cn(
        'min-w-0 rounded-lg border px-4 py-2 text-start',
        TONE_TILE[tone],
        className
    );

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                aria-pressed={selected}
                className={cn(
                    tileClass,
                    'w-full transition-colors hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
                    selected && 'border-primary-500 ring-1 ring-primary-500'
                )}
            >
                {body}
            </button>
        );
    }

    return <div className={tileClass}>{body}</div>;
}
