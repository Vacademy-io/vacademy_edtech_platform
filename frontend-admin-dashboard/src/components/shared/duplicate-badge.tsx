import { cn } from '@/lib/utils';

interface DuplicateBadgeProps {
    isDuplicate: boolean | null | undefined;
    /**
     * Live duplicate enquiries that repeat this lead. A list that hides duplicates
     * badges the lead they repeat instead, so the person still reads as a duplicate.
     */
    duplicateCount?: number | null;
    className?: string;
}

export function DuplicateBadge({ isDuplicate, duplicateCount, className }: DuplicateBadgeProps) {
    const repeats = duplicateCount ?? 0;
    if (!isDuplicate && repeats <= 0) return null;

    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-600',
                className
            )}
            title={
                !isDuplicate
                    ? `Enquired again ${repeats} ${repeats === 1 ? 'time' : 'times'}, see Duplicate Leads`
                    : undefined
            }
        >
            Duplicate
        </span>
    );
}
