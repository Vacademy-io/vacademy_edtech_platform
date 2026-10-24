import { cn } from '@/lib/utils';

/**
 * Label + count pill for a list header. The Student List shows Total / Active / Inactive; Manage
 * Contacts reuses it for its Total so the two lists read the same. Its own module so a screen can
 * take the badge without pulling in the Student List header and everything that imports.
 */
export const CountBadge = ({
    label,
    value,
    tone,
    isCompact,
}: {
    label: string;
    value: number;
    tone: 'total' | 'active' | 'inactive' | 'invited';
    isCompact: boolean;
}) => {
    // Fixed semantic scales (not the white-labeled `primary`, whose per-institute
    // shades can clash) with -700 text for readable contrast on the -50/-100 surface.
    const toneClasses = {
        total: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
        active: 'bg-success-50 text-success-700 ring-success-200',
        inactive: 'bg-warning-50 text-warning-700 ring-warning-200',
        invited: 'bg-info-50 text-info-700 ring-info-200',
    }[tone];

    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full text-xs font-medium ring-1',
                isCompact ? 'px-1.5 py-0.5' : 'px-2 py-0.5',
                toneClasses
            )}
        >
            <span>{label}</span>
            <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>
        </span>
    );
};
