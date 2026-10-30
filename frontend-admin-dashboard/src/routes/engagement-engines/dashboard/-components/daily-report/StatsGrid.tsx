import { Info } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { CellTone, ReportStat } from '../../-utils/report-tables';

const VALUE_TONE: Record<CellTone | 'default', string> = {
    default: 'text-neutral-900',
    danger: 'text-danger-600',
    warning: 'text-warning-700',
    success: 'text-success-700',
    muted: 'text-neutral-400',
};

/** A small info icon whose tooltip says what a number means. */
export function InfoHint({ label, hint }: { label: string; hint: string }) {
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label={`${label}: ${hint}`}
                        className="shrink-0 rounded-full text-neutral-400 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <Info size={14} />
                    </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{hint}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

/** A handful of figures for a block that has one value per metric (calls, email, costs). */
export function StatsGrid({
    stats,
    note,
    noteHint,
    compact,
}: {
    stats: ReportStat[];
    note?: string;
    /** A short tooltip beside the note. */
    noteHint?: string;
    /** For half-width cards: two figures across instead of up to five. */
    compact?: boolean;
}) {
    return (
        <div className="flex flex-col gap-3">
            <dl
                className={cn(
                    'grid grid-cols-2 gap-3',
                    !compact && 'sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                )}
            >
                {stats.map((s) => (
                    <div
                        key={s.key}
                        className="min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
                    >
                        <dt className="flex items-center justify-between gap-1 text-neutral-500">
                            <span className="truncate text-caption">{s.label}</span>
                            {s.hint && <InfoHint label={s.label} hint={s.hint} />}
                        </dt>
                        <dd className="mt-1 flex flex-wrap items-center gap-2">
                            <span
                                className={cn(
                                    'font-semibold tabular-nums',
                                    VALUE_TONE[s.tone ?? 'default']
                                )}
                            >
                                <span className={s.tone === 'muted' ? 'text-body' : 'text-title'}>
                                    {s.text}
                                </span>
                            </span>
                            {s.badge && (
                                <span className="rounded-full bg-warning-50 px-2 py-0.5 text-warning-700">
                                    <span className="text-caption">{s.badge}</span>
                                </span>
                            )}
                        </dd>
                    </div>
                ))}
            </dl>
            {note && (
                <p className="flex items-center gap-1.5 text-neutral-500">
                    <span className="text-caption">{note}</span>
                    {noteHint && <InfoHint label={note} hint={noteHint} />}
                </p>
            )}
        </div>
    );
}
