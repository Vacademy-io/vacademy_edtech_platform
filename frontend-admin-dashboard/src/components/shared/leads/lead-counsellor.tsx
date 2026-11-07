import { UserPlus } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { LeadAvatar } from './lead-avatar';
import { counsellorDisplayName } from './counsellor-display';

/**
 * LeadCounsellor — the "Agent" cell shared by the list and the board card.
 * Shows the assigned counsellor (avatar + name) with a quiet "Reassign" link,
 * or a dashed "Assign" affordance when none is set.
 */

interface LeadCounsellorProps {
    counsellorName?: string | null;
    /** Authoritative: a lead with an id is owned even when the name is missing. */
    counsellorId?: string | null;
    onAssign?: () => void;
    className?: string;
}

export function LeadCounsellor({
    counsellorName,
    counsellorId,
    onAssign,
    className,
}: LeadCounsellorProps) {
    const owner = counsellorDisplayName({
        assigned_counselor_id: counsellorId,
        assigned_counselor_name: counsellorName,
    });
    if (owner) {
        return (
            <div className={cn('flex min-w-0 items-center gap-2', className)}>
                <LeadAvatar name={owner} size="sm" />
                <span className="truncate text-sm text-neutral-800">{owner}</span>
                {onAssign && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onAssign();
                        }}
                        className="shrink-0 text-xs text-neutral-400 hover:text-primary-600"
                    >
                        Reassign
                    </button>
                )}
            </div>
        );
    }
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onAssign?.();
            }}
            className={cn(
                'inline-flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-primary-300 hover:text-primary-600',
                className
            )}
        >
            <UserPlus className="size-3.5" />
            Assign
        </button>
    );
}
