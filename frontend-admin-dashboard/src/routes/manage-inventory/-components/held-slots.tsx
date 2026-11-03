import { Info } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { PackageSessionInventory } from '../-types/inventory-types';

interface HeldSlotsProps {
    item: PackageSessionInventory;
    className?: string;
}

/**
 * "Held N" next to a session's available stock. Held stock is already taken out of Available, so
 * this explains the temporary dips: it comes back after 30 minutes, or sooner if the payment
 * window is closed. The count is visible on its own; the tooltip only explains it.
 *
 * Renders nothing while the figures load, and for unlimited items (they never hold stock).
 */
export const HeldSlots = ({ item, className }: HeldSlotsProps) => {
    if (item.isLoadingInventory || item.isUnlimited !== false || item.heldSlots === undefined) {
        return null;
    }

    const held = item.heldSlots;
    const learners = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner).toLowerCase();

    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label={`${held.toLocaleString()} held while ${learners} are paying`}
                        className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            held > 0
                                ? 'bg-info-50 text-info-700'
                                : 'bg-muted text-muted-foreground',
                            className
                        )}
                    >
                        <Info size={12} />
                        Held {held.toLocaleString()}
                    </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center">
                    {`Reserved while ${learners} are paying, so it is already out of Available. It is released after 30 minutes, or as soon as the payment window is closed.`}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};
