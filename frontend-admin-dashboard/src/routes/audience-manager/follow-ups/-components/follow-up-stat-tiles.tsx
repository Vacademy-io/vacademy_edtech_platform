import {
    Warning,
    Sun,
    CalendarBlank,
    ListChecks,
    CheckCircle,
    CaretRight,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/utils';
import type { FollowUpBucket } from './follow-up-buckets';

/**
 * FollowUpStatTiles — the dominant element of the Follow-ups page.
 *
 * Three large bucket cards (Pending / Today / Upcoming) plus an "All" tile.
 * Counts are derived from the current page of fetched leads (UI-only stand-in
 * for a future global-count endpoint — swap-in is trivial because the page
 * already passes the precomputed counts as props).
 *
 * Each tile is clickable; the active bucket gets a primary-coloured ring.
 */

interface FollowUpStatTilesProps {
    counts: Record<FollowUpBucket, number>;
    active: FollowUpBucket;
    onChange: (bucket: FollowUpBucket) => void;
    /** Pinned by the route (?lock=bucket): the cards still report their counts,
     *  they just stop being a way to leave the sub-tab you opened. */
    locked?: boolean;
}

interface TileSpec {
    bucket: FollowUpBucket;
    label: string;
    caption: string;
    Icon: typeof Warning;
    tone: 'danger' | 'warning' | 'info' | 'neutral' | 'success';
}

const buildTiles = (t: TFunction): TileSpec[] => [
    {
        bucket: 'overdue',
        label: t('tiles.overdue.label'),
        caption: t('tiles.overdue.caption'),
        Icon: Warning,
        tone: 'danger',
    },
    {
        bucket: 'today',
        label: t('tiles.today.label'),
        caption: t('tiles.today.caption'),
        Icon: Sun,
        tone: 'warning',
    },
    {
        bucket: 'upcoming',
        label: t('tiles.upcoming.label'),
        caption: t('tiles.upcoming.caption'),
        Icon: CalendarBlank,
        tone: 'info',
    },
    {
        bucket: 'all',
        label: t('tiles.all.label'),
        caption: t('tiles.all.caption'),
        Icon: ListChecks,
        tone: 'neutral',
    },
    {
        bucket: 'completed',
        label: t('tiles.completed.label'),
        caption: t('tiles.completed.caption'),
        Icon: CheckCircle,
        tone: 'success',
    },
];

// Token-only tone palette — no raw hex.
const TONE_BG: Record<TileSpec['tone'], string> = {
    danger: 'bg-danger-50',
    warning: 'bg-warning-50',
    info: 'bg-info-50',
    neutral: 'bg-neutral-50',
    success: 'bg-success-50',
};
const TONE_ICON: Record<TileSpec['tone'], string> = {
    danger: 'text-danger-500',
    warning: 'text-warning-500',
    info: 'text-info-500',
    neutral: 'text-neutral-500',
    success: 'text-success-500',
};
const TONE_BORDER: Record<TileSpec['tone'], string> = {
    danger: 'border-danger-200',
    warning: 'border-warning-200',
    info: 'border-info-200',
    neutral: 'border-neutral-200',
    success: 'border-success-200',
};

export function FollowUpStatTiles({
    counts,
    active,
    onChange,
    locked = false,
}: FollowUpStatTilesProps) {
    const { t } = useTranslation('audienceManagerFollowUpStatTiles');
    const tiles = buildTiles(t);
    return (
        <div className="flex flex-wrap gap-3">
            {tiles.map(({ bucket, label, caption, Icon, tone }) => {
                const isActive = active === bucket;
                const count = counts[bucket] ?? 0;
                return (
                    <button
                        key={bucket}
                        type="button"
                        onClick={() => !locked && onChange(bucket)}
                        aria-disabled={locked || undefined}
                        className={cn(
                            'flex min-w-44 flex-1 items-center gap-3 rounded-xl border px-5 py-4 text-left transition-all',
                            TONE_BG[tone],
                            // A pinned row is still readable; it just is not a control.
                            locked && 'cursor-default',
                            locked && !isActive && 'opacity-60',
                            isActive
                                ? 'border-primary-400 ring-2 ring-primary-200'
                                : cn(TONE_BORDER[tone], !locked && 'hover:border-neutral-300')
                        )}
                        aria-pressed={isActive}
                    >
                        {/* The icon sits on its own white tile so it reads as a mark
                            rather than as part of the number next to it. */}
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/80">
                            <Icon weight="fill" className={cn('size-6', TONE_ICON[tone])} />
                        </span>
                        <div className="min-w-0 flex-1">
                            {/* Grouped: these used to top out at the 200 rows the page had
                                fetched, so four digits never came up. They do now. */}
                            <p className="text-3xl font-semibold leading-none text-neutral-900">
                                {count.toLocaleString()}
                            </p>
                            <p className="mt-1.5 text-sm font-medium text-neutral-700">{label}</p>
                            <p className="text-xs text-neutral-500">{caption}</p>
                        </div>
                        <span
                            className={cn(
                                'flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors',
                                isActive
                                    ? 'border-primary-400 bg-primary-500 text-neutral-50'
                                    : 'border-neutral-200 bg-white/80 text-neutral-400'
                            )}
                            aria-hidden="true"
                        >
                            <CaretRight className="size-3.5" weight="bold" />
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
