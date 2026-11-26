import { cn } from '@/lib/utils';
import type { JourneyStatusDef } from '@/services/journey-status';

/**
 * A learner's journey status (Learning, Temporary Break, At Risk, ...) as a small pill. The dot
 * takes the colour the institute chose for the status in Settings → Journey status.
 */
export const JourneyStatusBadge = ({
    def,
    fallbackLabel,
    className,
    suffix,
}: {
    def?: JourneyStatusDef;
    fallbackLabel?: string;
    className?: string;
    suffix?: string;
}) => (
    <span
        className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-neutral-700',
            className
        )}
    >
        <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-neutral-400"
            // Institute-chosen status colour (user data), so it cannot be a token.
            style={def?.color ? { backgroundColor: def.color } : undefined}
        />
        <span className="truncate">{def?.label ?? fallbackLabel ?? '—'}</span>
        {suffix && <span className="font-normal text-neutral-500">{suffix}</span>}
    </span>
);
