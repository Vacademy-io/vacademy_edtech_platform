import { useQuery } from '@tanstack/react-query';
import { Phone } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { CallPickerPopover } from '@/components/shared/leads/call-picker-popover';
import { usePlaceCall } from '@/components/shared/leads/use-place-call';
import {
    fetchCallAvailability,
    type CallAvailability,
} from '@/components/shared/leads/services/call-options';

/**
 * Click-to-call button for a person who is NOT (necessarily) a CRM lead —
 * an enrolled learner in the students list, the attendance tracker, or an
 * assessment's participants, all of which open the same student side-view.
 *
 * The lead surfaces call by `responseId` (audience_response). Learners have no
 * such row, so this passes `userId` alone and the backend resolves the person,
 * their phone, and — when the learner ALSO came through a form — the lead row to
 * file the call under, so one person never ends up with two call histories.
 *
 * Same picker + live-status toast as the leads Call button: an accidental click
 * costs a popover, not provider credits.
 */
interface ContactCallButtonProps {
    /** The person being called (auth user id). */
    userId?: string | null;
    /**
     * audience_response id, when this row IS a CRM lead. The student side-view is
     * shared with the lead surfaces, and a lead is usually not enrolled — passing
     * it makes the backend take the lead path (phone off the lead row) instead of
     * the learner path, whose institute-enrolment check a lead would fail.
     */
    responseId?: string | null;
    /** Their number — only used to decide whether calling is possible at all;
     *  the backend re-resolves it so we never dial a stale local value. */
    phone?: string | null;
    /** Shown on the post-call disposition sheet when the call files onto a lead. */
    name?: string | null;
    className?: string;
    /**
     * 'icon' (default) is the compact phone glyph that sits beside a number;
     * 'button' is a labelled secondary button for places where calling is the
     * primary action (e.g. the Remarks card on the learner Overview).
     */
    appearance?: 'icon' | 'button';
    /** Button-mode label; falls back to "Call". */
    label?: string;
}

/**
 * Two separate questions, two separate answers — see CallAvailabilityDTO.
 *
 * Cached per institute (not per row) so the many places that mount this button
 * share one request. On failure we say "not enabled", which hides the button:
 * if we cannot even ask, offering a call that would throw is worse than showing
 * nothing.
 */
function useCallAvailability(instituteId: string): CallAvailability {
    const query = useQuery({
        queryKey: ['telephony-availability', instituteId],
        queryFn: () => fetchCallAvailability(instituteId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
    return query.data ?? { enabled: false, callerReady: false };
}

export function ContactCallButton({
    userId,
    responseId,
    phone,
    name,
    className,
    appearance = 'icon',
    label,
}: ContactCallButtonProps) {
    const instituteId = getCurrentInstituteId() ?? '';
    const availability = useCallAvailability(instituteId);
    const placeCall = usePlaceCall();

    const hasPhone = !!phone && phone.trim() !== '' && phone.trim() !== '-';

    // Institute-level off → render nothing. Whoever is looking at this learner
    // cannot turn calling on from here, so a permanently dead button would just
    // be clutter that reads like a bug.
    if (!availability.enabled || (!userId && !responseId) || !hasPhone) return null;

    // Caller-level not set up → say so in the tooltip, but do NOT disable. The
    // probe is advisory (see OutboundOriginationResolver#callerBlockedReason);
    // treating it as a veto is what let one inverted Optional chain silence
    // calling for every correctly-configured Airtel user. A wrong "blocked"
    // would cost them calling entirely; a wrong "ready" costs one click and the
    // same error toast as before. The backend decides at dial time.
    const notReady = !availability.callerReady;
    const disabled = placeCall.isPending;
    const reason = notReady
        ? availability.reason ?? 'Your account may not be set up to place calls yet'
        : undefined;

    return (
        <CallPickerPopover
            leadUserId={userId}
            disabled={disabled}
            disabledReason={reason ?? (disabled ? 'A call is already being placed' : undefined)}
            onConfirm={(preferredNumberId) =>
                placeCall.mutate({
                    responseId: responseId ?? undefined,
                    userId: userId ?? undefined,
                    preferredNumberId: preferredNumberId || undefined,
                    leadName: name ?? undefined,
                })
            }
            trigger={
                appearance === 'button' ? (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={(e) => e.stopPropagation()}
                        disable={disabled}
                        title={reason ?? label ?? 'Call'}
                        className={className}
                    >
                        <Phone weight="fill" className="size-3.5" />
                        {label ?? 'Call'}
                    </MyButton>
                ) : (
                    <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        disabled={disabled}
                        title={reason ?? 'Call'}
                        aria-label="Call"
                        className={cn(
                            'inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors',
                            disabled
                                ? 'cursor-not-allowed opacity-50'
                                : 'hover:bg-success-50 hover:text-success-600',
                            className
                        )}
                    >
                        <Phone weight="fill" className="size-3.5" />
                    </button>
                )
            }
        />
    );
}
