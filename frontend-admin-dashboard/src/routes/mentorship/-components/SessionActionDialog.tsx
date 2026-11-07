import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { reportApiError } from '@/lib/report-api-error';
import {
    useMentorDashboard,
    useMyMentorProfile,
    useSessionAction,
} from '../-hooks/use-mentorship';
import { MentorSlotPicker } from './MentorSlotPicker';
import type { MentorSessionDTO } from '../-types/mentorship-types';

/**
 * Cancel or move one session. Both go through the same booking-module operations the
 * invitee's emailed link uses, so the live session, reminders, calendar entry and
 * notifications are handled identically however the change was initiated.
 */
export function SessionActionDialog({
    session,
    action,
    instituteId,
    asAdmin = true,
    onOpenChange,
}: {
    session: MentorSessionDTO | null;
    action: 'cancel' | 'reschedule' | null;
    instituteId: string | undefined;
    /** false for a mentor acting on their own session — the server enforces it either way. */
    asAdmin?: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('mentorshipSessionActionDialog');
    const [reason, setReason] = useState('');
    const [startTime, setStartTime] = useState<string | null>(null);
    const run = useSessionAction();

    // The new time has to be a slot the mentor is actually free for, so the picker needs
    // that mentor's booking page. An admin reads it off the mentor list they already have;
    // a mentor moving their own session reads their own profile (the admin list would 403).
    const dashboard = useMentorDashboard(asAdmin ? instituteId : undefined);
    const myProfile = useMyMentorProfile(asAdmin ? undefined : instituteId);
    const slug = asAdmin
        ? (dashboard.data?.mentors ?? []).find((m) => m.id === session?.mentor_id)
              ?.booking_page_slug ?? null
        : myProfile.data?.booking_page_slug ?? null;

    useEffect(() => {
        if (!session || !action) return;
        setReason('');
        setStartTime(null);
    }, [session, action]);

    const submit = async () => {
        if (!session || !action || !instituteId) return;
        if (action === 'reschedule' && !startTime) {
            toast.error(t('pickNewSlot'));
            return;
        }
        try {
            await run.mutateAsync({
                instituteId,
                bookingInstanceId: session.booking_instance_id,
                action,
                reason: reason.trim() || undefined,
                // The picker hands back the slot exactly as the availability API produced
                // it — an ISO offset datetime — so the instant is unambiguous. No
                // inviteeTimezone is sent: an admin or mentor moving someone else's
                // session must not overwrite the learner's zone with their own, and
                // omitting it makes the server keep whatever the booking already had.
                startTime: action === 'reschedule' ? startTime ?? undefined : undefined,
                asAdmin,
            });
            toast.success(action === 'cancel' ? t('sessionCancelled') : t('sessionMoved'));
            onOpenChange(false);
        } catch (error) {
            // Slot clashes and concurrent edits come back with a readable reason —
            // "This slot is no longer available" is the whole point of showing it.
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': `session-${action}` },
                extra: { bookingInstanceId: session.booking_instance_id },
                fallbackMessage:
                    action === 'cancel' ? t('cancelFailed') : t('rescheduleFailed'),
            });
        }
    };

    if (!session || !action) return null;
    const cancelling = action === 'cancel';

    return (
        <MyDialog
            heading={cancelling ? t('cancelHeading') : t('rescheduleHeading')}
            open={!!action}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('keepAsIs')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={submit}
                        disable={run.isPending}
                    >
                        {run.isPending
                            ? t('saving')
                            : cancelling
                              ? t('cancelSession')
                              : t('moveSession')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-600">
                    {cancelling ? (
                        <Trans
                            t={t}
                            i18nKey="cancelBody"
                            values={{
                                studentName: session.student_name || t('learnerFallback'),
                                mentorName: session.mentor_name || t('mentorFallback'),
                            }}
                            components={{ bold1: <b />, bold2: <b /> }}
                        />
                    ) : (
                        <Trans
                            t={t}
                            i18nKey="rescheduleBody"
                            values={{
                                studentName: session.student_name || t('learnerFallbackLower'),
                            }}
                            components={{ bold1: <b /> }}
                        />
                    )}
                </p>

                {!cancelling && (
                    <div className="flex flex-col gap-2">
                        <span className="text-caption font-medium text-neutral-600">
                            {t('newDateTime')}
                        </span>
                        <MentorSlotPicker
                            instituteId={instituteId}
                            slug={slug}
                            duration={session.duration_minutes ?? undefined}
                            value={startTime}
                            onChange={setStartTime}
                        />
                    </div>
                )}

                <MyInput
                    input={reason}
                    onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setReason(e.target.value)
                    }
                    inputType="text"
                    inputPlaceholder={
                        cancelling ? t('reasonCancelPlaceholder') : t('reasonOptionalPlaceholder')
                    }
                    label={cancelling ? t('reasonCancelLabel') : t('reasonOptionalLabel')}
                    className="sm:w-full"
                />
            </div>
        </MyDialog>
    );
}
