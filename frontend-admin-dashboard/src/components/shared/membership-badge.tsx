import { cn } from '@/lib/utils';

export type MembershipType = 'TRIAL' | 'TRIAL_ENDED' | 'PAID';

interface MembershipBadgeProps {
    /** From the learner row. Null/absent when they hold no plan at all. */
    membershipType?: MembershipType | null;
    /** False for institutes that run no trials, where every member would read "Paid". */
    available?: boolean;
    className?: string;
}

const STYLES: Record<MembershipType, { label: string; className: string }> = {
    // Amber reads as "in progress" and, unlike the secondary palette, actually has
    // enough contrast to look like a chip rather than stray text.
    TRIAL: { label: 'Trial', className: 'bg-yellow-100 text-yellow-800' },
    // A trial that ran out is neither a trial member nor a paying one. Grey keeps it
    // legible without implying either.
    TRIAL_ENDED: { label: 'Trial ended', className: 'bg-neutral-100 text-neutral-600' },
    PAID: { label: 'Paid', className: 'bg-success-100 text-success-600' },
};

/**
 * Trial / Trial ended / Paid for an enrolled learner. Renders nothing when they hold no
 * membership at all: an absent badge is the honest answer, not a defaulted one.
 */
export function MembershipBadge({ membershipType, available = false, className }: MembershipBadgeProps) {
    if (!available || !membershipType) return null;
    const style = STYLES[membershipType];
    if (!style) return null;

    return (
        <span
            className={cn(
                'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium',
                style.className,
                className
            )}
        >
            {style.label}
        </span>
    );
}
