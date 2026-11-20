import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    BellSlash,
    CaretDown,
    CaretRight,
    CreditCard,
    LockSimple,
    Pause,
    PauseCircle,
    Plus,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import { cn } from '@/lib/utils';
import {
    ENROLMENT_BREAKS_QUERY_KEY,
    cancelBreak,
    useEnrolmentBreakSettings,
    useLearnerBreaks,
    type EnrolmentBreak,
} from '@/services/enrolment-breaks';
import { breakStatusKey, formatDay, lengthInDays, localToday, toneClasses } from './break-utils';
import { NewBreakDialog } from './new-break-dialog';
import { ResumeBreakDialog } from './resume-break-dialog';
import { ChangeBreakDialog } from './change-break-dialog';

interface EnrolmentBreaksCardProps {
    userId: string;
    instituteId: string;
    learnerName?: string;
}

const StatusPill = ({ brk }: { brk: EnrolmentBreak }) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const { key, tone } = breakStatusKey(brk);
    return (
        <span
            className={cn(
                'rounded-full px-2 py-0.5 text-caption font-semibold ring-1',
                toneClasses[tone]
            )}
        >
            {t(`status.${key}`)}
        </span>
    );
};

const EffectChip = ({ icon, label }: { icon: React.ReactNode; label: string }) => (
    <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600">
        {icon}
        {label}
    </span>
);

/** One live (scheduled or running) break, with its actions. */
const LiveBreak = ({
    brk,
    onChange,
    onResume,
    onCancel,
}: {
    brk: EnrolmentBreak;
    onChange: () => void;
    onResume: () => void;
    onCancel: () => void;
}) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const total = lengthInDays(brk.starts_on, brk.ends_on);
    const running = brk.status === 'ACTIVE';
    const day = brk.days_so_far ?? 1;
    const progress = running && total ? Math.min(100, (day / total) * 100) : 0;
    const Icon = brk.kind === 'PAUSE' ? PauseCircle : BellSlash;

    return (
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                    <span className="rounded-md bg-warning-100 p-1.5 text-warning-700">
                        <Icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-body font-semibold text-neutral-800">
                                {t(brk.kind === 'PAUSE' ? 'card.pauseName' : 'card.holdName')}
                            </span>
                            {!running && <StatusPill brk={brk} />}
                        </div>
                        <p className="truncate text-caption text-neutral-500">
                            {brk.course_label || t('card.allCourses')}
                        </p>
                    </div>
                </div>
                <div className="shrink-0 text-end text-caption text-neutral-600">
                    <span className="font-semibold">
                        {running
                            ? total
                                ? t('card.dayOf', { day, total })
                                : t('card.dayN', { day })
                            : t('card.startsOn', { date: formatDay(brk.starts_on) })}
                    </span>
                    <span className="block">
                        {brk.ends_on
                            ? t('card.until', { date: formatDay(brk.ends_on) })
                            : t('card.noEndDate')}
                    </span>
                </div>
            </div>

            {running && total ? (
                <Progress
                    value={progress}
                    className="mt-3 h-1.5"
                    aria-label={t('card.dayOf', { day, total })}
                />
            ) : null}

            <div className="mt-3 flex flex-wrap gap-1.5">
                {brk.stop_class_reminders && (
                    <EffectChip
                        icon={<BellSlash className="size-3" />}
                        label={t('effects.classOff')}
                    />
                )}
                {brk.stop_fee_reminders && (
                    <EffectChip
                        icon={<BellSlash className="size-3" />}
                        label={t('effects.feeOff')}
                    />
                )}
                {brk.kind === 'PAUSE' && brk.remove_access && (
                    <EffectChip
                        icon={<LockSimple className="size-3" />}
                        label={t('effects.accessOff')}
                    />
                )}
                {brk.kind === 'PAUSE' && (
                    <EffectChip
                        icon={<CreditCard className="size-3" />}
                        label={t('effects.billingOff')}
                    />
                )}
            </div>

            {(brk.reason || brk.note) && (
                <p className="mt-2 text-caption text-neutral-600">
                    {brk.reason && (
                        <span className="font-semibold">
                            {t(`reasons.${brk.reason}`, { defaultValue: brk.reason })}
                        </span>
                    )}
                    {brk.reason && brk.note ? ' · ' : ''}
                    {brk.note}
                </p>
            )}

            <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-warning-100 pt-2">
                <MyButton type="button" buttonType="secondary" scale="small" onClick={onChange}>
                    {t('card.change')}
                </MyButton>
                {running ? (
                    <MyButton type="button" buttonType="primary" scale="small" onClick={onResume}>
                        {t(brk.kind === 'PAUSE' ? 'card.resume' : 'card.endHold')}
                    </MyButton>
                ) : (
                    <MyButton type="button" buttonType="secondary" scale="small" onClick={onCancel}>
                        {t('card.cancel')}
                    </MyButton>
                )}
            </div>
        </div>
    );
};

const PastBreakRow = ({ brk }: { brk: EnrolmentBreak }) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const happened = brk.status === 'ENDED';
    const days = happened && brk.ends_on ? lengthInDays(brk.starts_on, brk.ends_on) : null;
    return (
        <li className="flex items-start justify-between gap-3 py-2 text-caption">
            <div className="min-w-0">
                <span className="font-semibold text-neutral-800">
                    {t(brk.kind === 'PAUSE' ? 'card.pauseName' : 'card.holdName')}
                </span>
                <span className="text-neutral-500">
                    {' '}
                    · {brk.course_label || t('card.allCourses')}
                </span>
                <span className="block text-neutral-500">
                    {formatDay(brk.starts_on)}
                    {brk.ends_on ? ` – ${formatDay(brk.ends_on)}` : ''}
                    {days ? ` · ${t('form.lengthDays', { count: days })}` : ''}
                    {happened && brk.kind === 'PAUSE' && brk.shifted_days
                        ? ` · ${t('card.datesMoved', { count: brk.shifted_days })}`
                        : ''}
                </span>
            </div>
            <StatusPill brk={brk} />
        </li>
    );
};

/**
 * Breaks and holds for one learner, at the top of the Membership tab. Shown when the
 * institute has switched the feature on; when it was switched off later, breaks that are
 * still running stay visible (read-only apart from ending them) so none is ever stranded.
 */
export const EnrolmentBreaksCard = ({
    userId,
    instituteId,
    learnerName,
}: EnrolmentBreaksCardProps) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const queryClient = useQueryClient();
    const settings = useEnrolmentBreakSettings();
    // Only institutes that ever saved the setting can have breaks, so only they load this.
    const { data, isLoading, isError, refetch } = useLearnerBreaks(
        userId,
        instituteId,
        settings.configured
    );

    const [adding, setAdding] = useState(false);
    const [resumeOf, setResumeOf] = useState<EnrolmentBreak | null>(null);
    const [changeOf, setChangeOf] = useState<EnrolmentBreak | null>(null);
    const [cancelOf, setCancelOf] = useState<EnrolmentBreak | null>(null);
    const [showHistory, setShowHistory] = useState(false);

    const cancelMutation = useMutation({
        mutationFn: (b: EnrolmentBreak) => cancelBreak(instituteId, b.id),
        onSuccess: () => {
            toast.success(t('toast.cancelled'));
            queryClient.invalidateQueries({ queryKey: [ENROLMENT_BREAKS_QUERY_KEY] });
            setCancelOf(null);
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('toast.failed'));
        },
    });

    const live =
        data?.breaks.filter((b) => b.status === 'ACTIVE' || b.status === 'SCHEDULED') ?? [];
    const past = data?.breaks.filter((b) => b.status === 'ENDED' || b.status === 'CANCELLED') ?? [];

    if (!userId || !settings.configured) return null;
    if (!settings.enabled && live.length === 0) return null;

    const courses = data?.courses ?? [];
    const today = data?.today ?? localToday();
    const allCoursesTaken = live.some((b) => !b.package_session_id);
    const takenCourses = new Set(live.map((b) => b.package_session_id).filter(Boolean));
    const available = allCoursesTaken
        ? []
        : courses.filter((c) => !takenCourses.has(c.package_session_id));
    const addDisabledReason =
        courses.length === 0
            ? t('card.noCourses')
            : available.length === 0
              ? t('card.allTaken')
              : null;

    return (
        <section
            className="rounded-lg border border-neutral-200 bg-card p-3"
            aria-labelledby="enrolment-breaks-title"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                    <span className="rounded-md bg-primary-50 p-1.5 text-primary-500">
                        <Pause className="size-4" />
                    </span>
                    <div className="min-w-0">
                        <h3
                            id="enrolment-breaks-title"
                            className="text-body font-semibold text-neutral-800"
                        >
                            {t('card.title')}
                        </h3>
                        <p className="text-caption text-neutral-500">{t('card.subtitle')}</p>
                    </div>
                </div>
                {settings.enabled && !isLoading && !isError && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    disable={Boolean(addDisabledReason)}
                                    onClick={() => setAdding(true)}
                                >
                                    <Plus className="me-1 size-3.5" />
                                    {t('card.add')}
                                </MyButton>
                            </span>
                        </TooltipTrigger>
                        {addDisabledReason && (
                            <TooltipContent side="bottom">{addDisabledReason}</TooltipContent>
                        )}
                    </Tooltip>
                )}
            </div>

            <div className="mt-3 space-y-2">
                {!settings.enabled && live.length > 0 && (
                    <p className="rounded-md bg-info-50 p-3 text-caption text-info-700 ring-1 ring-info-200">
                        {t('card.offNotice')}
                    </p>
                )}

                {isLoading && <Skeleton className="h-16 w-full" />}

                {isError && (
                    <div className="flex items-center justify-between gap-2 rounded-md bg-danger-50 p-3 text-caption text-danger-700 ring-1 ring-danger-200">
                        <span>{t('card.error')}</span>
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={() => refetch()}
                        >
                            {t('card.retry')}
                        </MyButton>
                    </div>
                )}

                {!isLoading && !isError && live.length === 0 && (
                    <p className="rounded-md bg-neutral-50 p-3 text-caption text-neutral-500">
                        {courses.length === 0 ? t('card.noCourses') : t('card.empty')}
                    </p>
                )}

                {live.map((b) => (
                    <LiveBreak
                        key={b.id}
                        brk={b}
                        onChange={() => setChangeOf(b)}
                        onResume={() => setResumeOf(b)}
                        onCancel={() => setCancelOf(b)}
                    />
                ))}

                {past.length > 0 && (
                    <div className="border-t border-neutral-100 pt-2">
                        <button
                            type="button"
                            onClick={() => setShowHistory((v) => !v)}
                            className="flex items-center gap-1 rounded-sm text-caption font-semibold text-neutral-600 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                            aria-expanded={showHistory}
                        >
                            {showHistory ? (
                                <CaretDown className="size-3" />
                            ) : (
                                <CaretRight className="size-3 rtl:rotate-180" />
                            )}
                            {t('card.history', { count: past.length })}
                        </button>
                        {showHistory && (
                            <ul className="mt-1 divide-y divide-neutral-100">
                                {past.map((b) => (
                                    <PastBreakRow key={b.id} brk={b} />
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>

            {adding && (
                <NewBreakDialog
                    onClose={() => setAdding(false)}
                    userId={userId}
                    instituteId={instituteId}
                    learnerName={learnerName}
                    today={today}
                    courses={available}
                    allowAllCourses={live.length === 0}
                />
            )}
            {resumeOf && (
                <ResumeBreakDialog
                    key={resumeOf.id}
                    onClose={() => setResumeOf(null)}
                    brk={resumeOf}
                    instituteId={instituteId}
                    today={today}
                />
            )}
            {changeOf && (
                <ChangeBreakDialog
                    key={changeOf.id}
                    onClose={() => setChangeOf(null)}
                    brk={changeOf}
                    instituteId={instituteId}
                    today={today}
                />
            )}
            <AlertDialog open={cancelOf !== null} onOpenChange={(o) => !o && setCancelOf(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('cancel.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {cancelOf &&
                                t('cancel.description', { date: formatDay(cancelOf.starts_on) })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('cancel.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                if (cancelOf) cancelMutation.mutate(cancelOf);
                            }}
                            disabled={cancelMutation.isPending}
                        >
                            {t('cancel.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
};
