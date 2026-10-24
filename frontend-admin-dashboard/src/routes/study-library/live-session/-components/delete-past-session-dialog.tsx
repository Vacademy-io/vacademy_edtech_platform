import { useState } from 'react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarBlank, Clock, Warning } from '@phosphor-icons/react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { deleteLiveSession } from '../schedule/-services/utils';

interface DeletePastSessionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    scheduleId: string;
    title: string;
    dateLabel: string;
    timeRangeLabel: string;
    isRecurring: boolean;
    /** The institute's name for a live session ("Class", "Live Session", …). */
    term: string;
}

/**
 * Confirmation for deleting ONE past class from the Past tab.
 *
 * Always deletes just this occurrence (type `schedule`): offering "the whole
 * series" here would also wipe the upcoming classes of a recurring session.
 * Learners are never notified — a cancellation mail for a class that already
 * happened is wrong. Who deleted it is recorded server-side in the admin
 * activity log.
 */
export default function DeletePastSessionDialog({
    open,
    onOpenChange,
    scheduleId,
    title,
    dateLabel,
    timeRangeLabel,
    isRecurring,
    term,
}: DeletePastSessionDialogProps) {
    const { t } = useTranslation('studyLibraryDeletePastSessionDialog');
    const [isDeleting, setIsDeleting] = useState(false);
    const queryClient = useQueryClient();

    const handleDelete = async (e: MouseEvent<HTMLButtonElement>) => {
        // Keep the dialog open until the request settles.
        e.preventDefault();
        setIsDeleting(true);
        try {
            await deleteLiveSession([scheduleId], 'schedule', false);
            await queryClient.invalidateQueries({ queryKey: ['liveSessions'] });
            await queryClient.invalidateQueries({ queryKey: ['upcomingSessions'] });
            await queryClient.invalidateQueries({ queryKey: ['pastSessions'] });
            await queryClient.invalidateQueries({ queryKey: ['sessionSearch'] });
            toast.success(t('toast.deleted', { term }));
            onOpenChange(false);
        } catch {
            toast.error(t('toast.deleteFailed'));
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={(next) => !isDeleting && onOpenChange(next)}>
            {/* grid-cols-1 = minmax(0, 1fr): the base content is an auto-width grid,
                so one long unbreakable line would widen the column past max-w-lg
                and spill the text out of the panel. */}
            <AlertDialogContent className="grid-cols-1" onClick={(e) => e.stopPropagation()}>
                <AlertDialogHeader>
                    <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-50 text-danger-600">
                            <Warning size={22} weight="fill" />
                        </div>
                        <div className="min-w-0 space-y-1.5">
                            <AlertDialogTitle>{t('title', { term })}</AlertDialogTitle>
                            <AlertDialogDescription>
                                {t('description', { term: term.toLowerCase() })}
                            </AlertDialogDescription>
                        </div>
                    </div>
                </AlertDialogHeader>

                <div className="min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                    {/* Wraps rather than truncates — the admin should read the full
                        class name before confirming a delete. */}
                    <div className="break-words text-sm font-semibold text-neutral-800">
                        {title}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
                        <span className="inline-flex items-center gap-1.5">
                            <CalendarBlank size={14} />
                            {dateLabel}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <Clock size={14} />
                            {timeRangeLabel}
                        </span>
                    </div>
                </div>

                <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-600">
                    {isRecurring ? (
                        <li>{t('points.onlyThisOccurrence', { term: term.toLowerCase() })}</li>
                    ) : null}
                    <li>{t('points.noNotification')}</li>
                    <li>{t('points.audited')}</li>
                </ul>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>{t('actions.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleDelete}
                        disabled={isDeleting || !scheduleId}
                        className="bg-danger-600 text-white hover:bg-danger-700 focus:ring-danger-600"
                    >
                        {isDeleting ? t('actions.deleting') : t('actions.delete', { term })}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
