import { useState } from 'react';
import { Check, CircleNotch, CaretDown } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LeadStatusChip } from '@/components/shared/lead-status-chip';
import { setLeadStatusForLead, type LeadStatus } from '@/hooks/use-lead-statuses';

const normalize = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '_');

interface LeadStatusSelectProps {
    /** Audience response id of the lead whose status is being changed. */
    responseId?: string;
    /** Current status (key or label) shown on the chip. */
    currentStatus?: string | null;
    /** Institute's configured statuses (with ids, for the update call). */
    statuses: LeadStatus[];
    /** Called after a successful update so the caller can refetch its list. */
    onUpdated?: () => void;
    size?: 'sm' | 'md';
    /** Show a ▾ after the chip so it reads as a dropdown. */
    caret?: boolean;
}

/**
 * Inline, editable lead-status chip. Renders the current status as a colored
 * chip; clicking it opens a popover to pick a new status, which is persisted via
 * {@link setLeadStatusForLead} and then refreshed through `onUpdated`.
 */
export function LeadStatusSelect({
    responseId,
    currentStatus,
    statuses,
    onUpdated,
    size = 'sm',
    caret = false,
}: LeadStatusSelectProps) {
    const [open, setOpen] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    const chipStatuses = statuses.map((s) => ({
        key: s.status_key,
        label: s.label,
        color: s.color,
        order: s.display_order,
    }));

    const norm = currentStatus ? normalize(currentStatus) : null;
    const activeId =
        statuses.find(
            (s) => norm && (normalize(s.status_key) === norm || normalize(s.label) === norm)
        )?.id ?? null;

    const handleSelect = async (status: LeadStatus) => {
        if (status.id === activeId) {
            setOpen(false);
            return;
        }
        if (!responseId) {
            toast.error('Missing lead reference');
            return;
        }
        setOpen(false);
        setIsUpdating(true);
        try {
            await setLeadStatusForLead(responseId, status.id, 'MANUAL');
            toast.success(`Status updated to ${status.label}`);
            onUpdated?.();
        } catch {
            toast.error('Failed to update status');
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={isUpdating || statuses.length === 0}
                    // Keep the click on the chip — don't bubble to row/cell handlers
                    // (e.g. opening the lead side view).
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 rounded-full transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
                    title="Change status"
                >
                    {currentStatus ? (
                        <LeadStatusChip
                            status={currentStatus}
                            statuses={chipStatuses}
                            size={size}
                            hideDot
                        />
                    ) : (
                        <span className="inline-flex items-center rounded-full border border-dashed border-neutral-300 px-2 py-0.5 text-xs text-neutral-400">
                            Set status
                        </span>
                    )}
                    {caret && !isUpdating && <CaretDown className="size-3 text-neutral-400" />}
                    {isUpdating && <CircleNotch className="size-3 animate-spin text-neutral-400" />}
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-52 p-1">
                <div className="flex max-h-64 flex-col overflow-y-auto">
                    {statuses.map((s) => {
                        const active = s.id === activeId;
                        return (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => handleSelect(s)}
                                className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-100 ${
                                    active ? 'font-medium text-neutral-900' : 'text-neutral-700'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <span
                                        className="size-2 shrink-0 rounded-full"
                                        // Status colour is arbitrary user-picked hex — no token equivalent.
                                        style={{ backgroundColor: s.color }}
                                    />
                                    {s.label}
                                </span>
                                {active && <Check className="size-3.5 text-primary-600" />}
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default LeadStatusSelect;
