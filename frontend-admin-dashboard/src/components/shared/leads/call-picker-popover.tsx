import { cloneElement, useEffect, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Phone, Sparkle, X } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    fetchCallAvailability,
    fetchCallOptions,
    type NumberChoice,
} from './services/call-options';

/**
 * Runtime ExoPhone picker.
 *
 * - Trigger is rendered directly as the PopoverTrigger child (no wrapping
 *   <div>). Wrapping in another element here is dangerous — Radix's
 *   PopoverTrigger composes its onClick onto the immediate child via
 *   `asChild`, and a wrapping element with its own stopPropagation handler
 *   on a nested button silently kills the open event.
 * - The picker ALWAYS shows on click, even for single-ExoPhone institutes.
 *   This adds a one-click confirmation step in front of every dial so an
 *   accidental click on the row's Phone icon doesn't burn provider credits.
 *   Recommended number is pre-selected — counsellor's default action is
 *   still "click Call now" and dial happens immediately.
 */
interface CallPickerPopoverProps {
    /** The actual <button> that should open the popover. Rendered directly
     *  as Radix's trigger child — must accept onClick via clone. */
    trigger: ReactElement;
    /** Lead's user id — drives the strategy's "what number did this lead see last" lookup. */
    leadUserId: string | null | undefined;
    /** Allows the wrapping parent to gate the popover (no phone on file, etc.). */
    disabled?: boolean;
    /** Reason shown on the trigger tooltip when disabled. */
    disabledReason?: string;
    /** Fires after the counsellor picks + clicks Call. */
    onConfirm: (preferredNumberId: string) => void;
}

export function CallPickerPopover({
    trigger,
    leadUserId,
    disabled,
    disabledReason,
    onConfirm,
}: CallPickerPopoverProps) {
    const instituteId = getCurrentInstituteId() ?? '';
    const [open, setOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const optionsQuery = useQuery({
        queryKey: ['telephony-call-options', instituteId, leadUserId],
        queryFn: () => fetchCallOptions(instituteId, leadUserId ?? undefined),
        enabled: open && !!instituteId && !disabled,
        staleTime: 30 * 1000,
    });

    // Is THIS caller set up to originate? Without this the no-pool copy below
    // promised "dials from the extension mapped to you" to people who had no
    // extension mapped, and they only found out from an error toast after
    // clicking Call now. Same cache key as the Call buttons, so this is normally
    // already resolved by the time the popover opens.
    const availabilityQuery = useQuery({
        queryKey: ['telephony-availability', instituteId],
        queryFn: () => fetchCallAvailability(instituteId),
        enabled: open && !!instituteId && !disabled,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
    // Absent/failed answer must not block a dial that would otherwise work —
    // the backend re-checks at dial time and owns the real verdict.
    const callerNotReady = !!availabilityQuery.data && !availabilityQuery.data.callerReady;
    const callerBlockedReason = callerNotReady
        ? availabilityQuery.data?.reason ?? 'Your account is not set up to place calls yet'
        : null;

    const numbers: NumberChoice[] = optionsQuery.data?.numbers ?? [];
    const recommendedId = optionsQuery.data?.recommendedNumberId ?? null;
    // No-pool providers (Airtel) dial from the counsellor's own extension —
    // there is no caller-ID number to pick, so the picker just confirms the
    // dial. Defaults to true until data arrives (legacy Exotel shape).
    const usesNumberPool = optionsQuery.data?.usesNumberPool ?? true;
    const providerType = optionsQuery.data?.providerType ?? '';
    const providerLabel = providerType
        ? providerType.charAt(0) + providerType.slice(1).toLowerCase()
        : '';

    // Pre-select the strategy's recommendation the first time data arrives
    // for this open session. Counsellor's default action is then to click
    // "Call now" without touching the radios.
    useEffect(() => {
        if (open && selectedId == null && recommendedId) {
            setSelectedId(recommendedId);
        }
    }, [open, selectedId, recommendedId]);

    // Reset selection when the popover closes so a strategy change between
    // calls is honoured on the next open.
    useEffect(() => {
        if (!open) setSelectedId(null);
    }, [open]);

    const handleConfirm = () => {
        // Pooled providers require a picked number; no-pool providers dial from
        // the counsellor's extension, so an empty preferredNumberId is correct.
        if (usesNumberPool && !selectedId) return;
        onConfirm(usesNumberPool ? selectedId ?? '' : '');
        setOpen(false);
    };

    // Clone the trigger to inject a tooltip when disabled. We add `title`
    // directly to the child element — wrapping it in a <div> would break
    // Radix's asChild composition (see header comment).
    const triggerWithTooltip = disabled
        ? cloneElement(trigger, {
              title: disabledReason ?? trigger.props.title,
              disabled: true,
          })
        : trigger;

    return (
        <Popover open={disabled ? false : open} onOpenChange={(o) => !disabled && setOpen(o)}>
            <PopoverTrigger asChild>{triggerWithTooltip}</PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-80 p-0"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                        <Phone weight="fill" className="size-4 text-primary-600" />
                        <span className="text-sm font-semibold text-neutral-900">Call from</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                        aria-label="Close"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <div className="max-h-72 overflow-y-auto px-2 py-2">
                    {(optionsQuery.isLoading || availabilityQuery.isLoading) && (
                        <div className="space-y-2 px-2 py-1">
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                        </div>
                    )}
                    {optionsQuery.isError && (
                        <p className="px-3 py-2 text-xs text-danger-600">
                            Could not load calling numbers. Try again.
                        </p>
                    )}
                    {!optionsQuery.isLoading &&
                        !availabilityQuery.isLoading &&
                        !optionsQuery.isError &&
                        callerBlockedReason && (
                            <div className="mx-2 mb-1 rounded-md bg-warning-50 px-3 py-2">
                                <p className="text-xs font-medium text-warning-700">
                                    This call may not connect
                                </p>
                                <p className="mt-0.5 text-xs text-warning-600">
                                    {callerBlockedReason}
                                </p>
                            </div>
                        )}
                    {!optionsQuery.isLoading &&
                        !availabilityQuery.isLoading &&
                        !optionsQuery.isError &&
                        !usesNumberPool && (
                            <div className="px-3 py-2.5">
                                <p className="text-sm font-medium text-neutral-900">
                                    Calling from your extension
                                </p>
                                <p className="mt-1 text-xs text-neutral-500">
                                    {providerLabel
                                        ? `This call dials through ${providerLabel} from the extension mapped to you.`
                                        : 'This call dials from the extension mapped to you.'}{' '}
                                    The lead sees your configured caller ID.
                                </p>
                            </div>
                        )}
                    {usesNumberPool &&
                        !optionsQuery.isLoading &&
                        !optionsQuery.isError &&
                        numbers.length === 0 && (
                            <p className="px-3 py-2 text-xs text-neutral-500">
                                No calling numbers configured. Ask an admin to set one up under
                                Settings → Calling.
                            </p>
                        )}
                    {usesNumberPool &&
                        numbers.map((n) => {
                        const isRecommended = n.id === recommendedId;
                        const isSelected = n.id === selectedId;
                        return (
                            <button
                                key={n.id}
                                type="button"
                                onClick={() => setSelectedId(n.id)}
                                className={cn(
                                    'flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors',
                                    isSelected ? 'bg-primary-50' : 'hover:bg-neutral-50'
                                )}
                            >
                                <span
                                    className={cn(
                                        'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border',
                                        isSelected
                                            ? 'border-primary-600 bg-primary-600'
                                            : 'border-neutral-300 bg-white'
                                    )}
                                >
                                    {isSelected && (
                                        <span className="size-1.5 rounded-full bg-white" />
                                    )}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="truncate text-sm font-medium text-neutral-900">
                                            {n.label || n.phoneNumber}
                                        </span>
                                        {isRecommended && (
                                            <span className="inline-flex items-center gap-0.5 rounded-full bg-success-50 px-1.5 py-0.5 text-[10px] font-medium text-success-700">
                                                <Sparkle weight="fill" className="size-2.5" />
                                                Recommended
                                            </span>
                                        )}
                                    </div>
                                    {n.label && (
                                        <p className="truncate text-xs text-neutral-500">
                                            {n.phoneNumber}
                                            {n.region ? ` · ${n.region}` : ''}
                                        </p>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-3 py-2">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-8">
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleConfirm}
                        disabled={
                            optionsQuery.isLoading ||
                            availabilityQuery.isLoading ||
                            optionsQuery.isError ||
                            (usesNumberPool && (!selectedId || numbers.length === 0))
                        }
                        className="h-8"
                    >
                        <Phone weight="fill" className="mr-1 size-3.5" />
                        Call now
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
