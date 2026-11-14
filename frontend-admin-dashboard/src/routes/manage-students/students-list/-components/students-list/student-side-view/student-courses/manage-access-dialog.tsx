import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ArrowRight, ClockCounterClockwise } from '@phosphor-icons/react';
import { getInstituteId } from '@/constants/helper';
import type { PackageDetailDTO } from '@/routes/manage-students/students-list/-services/getLearnerPackages';
import {
    buildAccessChangePayload,
    useChangeLearnerAccessMutation,
    useLearnerAccessHistoryQuery,
    type AccessChangeMode,
    type LearnerAccessChangeRequest,
    type LearnerAccessChangeResponse,
} from '@/routes/manage-students/students-list/-services/learner-access';

type Step = 'CONFIG' | 'PREVIEW' | 'RESULTS' | 'HISTORY';

interface ManageAccessDialogProps {
    userId: string;
    userName: string;
    courses: PackageDetailDTO[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

/** Mode labels/hints are display-only — `mode` itself stays the untranslated
 *  AccessChangeMode value used for dispatch/comparison/payload logic below. */
const buildModeConfig = (t: TFunction): Record<AccessChangeMode, { label: string; hint: string }> => ({
    extend: { label: t('modes.extend.label'), hint: t('modes.extend.hint') },
    set_from_enrollment: {
        label: t('modes.setFromEnrollment.label'),
        hint: t('modes.setFromEnrollment.hint'),
    },
    set_date: { label: t('modes.setDate.label'), hint: t('modes.setDate.hint') },
    unlimited: { label: t('modes.unlimited.label'), hint: t('modes.unlimited.hint') },
});

const daysLeft = (value: string | null | undefined): number | null => {
    if (!value) return null;
    const diff = new Date(value).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86_400_000));
};

export const ManageAccessDialog = ({
    userId,
    userName,
    courses,
    open,
    onOpenChange,
    onSuccess,
}: ManageAccessDialogProps) => {
    const { t } = useTranslation('manageStudentsManageAccessDialog');
    const instituteId = getInstituteId() || '';
    const [step, setStep] = useState<Step>('CONFIG');
    const [selectedPSIds, setSelectedPSIds] = useState<Set<string>>(new Set());
    const [mode, setMode] = useState<AccessChangeMode>('extend');
    const [days, setDays] = useState<string>('30');
    const [expiryDate, setExpiryDate] = useState<string>('');
    const [reason, setReason] = useState<string>('');
    const [previewData, setPreviewData] = useState<LearnerAccessChangeResponse | null>(null);
    const [finalResults, setFinalResults] = useState<LearnerAccessChangeResponse | null>(null);

    const { mutateAsync: changeAccess, isPending } = useChangeLearnerAccessMutation();

    const { data: history, isLoading: isHistoryLoading } = useLearnerAccessHistoryQuery({
        instituteId,
        userId,
        // Only fetched once the admin opens the tab — the timeline is the least-used
        // half of this dialog and costs a round trip.
        enabled: open && step === 'HISTORY',
    });

    const courseByPSId = useMemo(() => {
        const map = new Map<string, PackageDetailDTO>();
        courses.forEach((c) => {
            if (c.package_session_id) map.set(c.package_session_id, c);
        });
        return map;
    }, [courses]);

    const modeConfig = useMemo(() => buildModeConfig(t), [t]);

    const formatExpiry = (value: string | null | undefined) =>
        value ? format(new Date(value), 'd MMM yyyy') : t('unlimitedLabel');

    const handleOpenChange = (isOpen: boolean) => {
        if (isOpen) {
            setStep('CONFIG');
            setSelectedPSIds(new Set());
            setMode('extend');
            setDays('30');
            setExpiryDate('');
            setReason('');
            setPreviewData(null);
            setFinalResults(null);
        }
        onOpenChange(isOpen);
    };

    const togglePS = (id: string) => {
        setSelectedPSIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const numericDays = parseInt(days, 10);
    const needsDays = mode === 'extend' || mode === 'set_from_enrollment';
    const isConfigValid =
        selectedPSIds.size > 0 &&
        (mode === 'unlimited' ||
            (mode === 'set_date' && Boolean(expiryDate)) ||
            // 'extend' accepts a negative number (shorten access); recomputing the whole
            // window from the enrollment date does not — the backend rejects <= 0, so
            // mirror that here rather than letting the request round-trip to fail.
            (mode === 'extend' && Number.isFinite(numericDays) && numericDays !== 0) ||
            (mode === 'set_from_enrollment' && Number.isFinite(numericDays) && numericDays > 0));

    const buildRequest = (dryRun: boolean): LearnerAccessChangeRequest => ({
        institute_id: instituteId,
        user_ids: [userId],
        package_session_ids: Array.from(selectedPSIds),
        ...buildAccessChangePayload({
            mode,
            days: needsDays ? numericDays : undefined,
            // The API takes an instant; the date input gives a calendar day, so anchor it
            // to end-of-day. Sending midnight would cut the last day of access short.
            expiryDate: expiryDate ? new Date(`${expiryDate}T23:59:59`).toISOString() : undefined,
        }),
        reason: reason.trim() || undefined,
        dry_run: dryRun,
    });

    const handlePreview = async () => {
        try {
            const result = await changeAccess(buildRequest(true));
            setPreviewData(result);
            setStep('PREVIEW');
        } catch (err) {
            toast.error(errorMessage(err, t('toasts.previewFailed')));
        }
    };

    const handleConfirm = async () => {
        try {
            const result = await changeAccess(buildRequest(false));
            setFinalResults(result);
            setStep('RESULTS');
            if (result.summary.updated > 0 && result.summary.failed === 0) {
                toast.success(t('toasts.accessUpdated', { count: result.summary.updated }));
                onSuccess();
            } else if (result.summary.updated > 0) {
                toast.warning(
                    t('toasts.partialUpdate', {
                        updated: result.summary.updated,
                        failed: result.summary.failed,
                    })
                );
                onSuccess();
            } else {
                toast.warning(t('toasts.noChanges'));
            }
        } catch (err) {
            toast.error(errorMessage(err, t('toasts.accessChangeFailed')));
        }
    };

    const renderConfig = () => (
        <div className="flex flex-col gap-5">
            <p className="text-sm text-neutral-600">
                <Trans
                    t={t}
                    i18nKey="config.changePrompt"
                    values={{ name: userName }}
                    components={{ strong: <strong /> }}
                />
            </p>

            <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
                {courses.length === 0 ? (
                    <p className="py-4 text-center text-sm text-neutral-400">
                        {t('config.noEnrollments')}
                    </p>
                ) : (
                    courses.map((c) => {
                        const psId = c.package_session_id;
                        if (!psId) return null;
                        const checked = selectedPSIds.has(psId);
                        const remaining = daysLeft(c.expiry_date);
                        return (
                            <label
                                key={c.id}
                                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all ${
                                    checked
                                        ? 'border-primary-300 bg-primary-50/40'
                                        : 'border-neutral-200 hover:border-neutral-300'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePS(psId)}
                                    className="size-4 rounded border-neutral-300 text-primary-500 focus:ring-primary-300"
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-neutral-800">
                                        {c.package_name || t('config.unnamedCourse')}
                                    </p>
                                    <p className="truncate text-xs text-neutral-500">
                                        {c.expiry_date
                                            ? remaining === 0
                                                ? t('config.expiresExpired', {
                                                      date: formatExpiry(c.expiry_date),
                                                  })
                                                : t('config.expiresRemaining', {
                                                      date: formatExpiry(c.expiry_date),
                                                      count: remaining ?? 0,
                                                  })
                                            : t('config.unlimitedAccess')}
                                    </p>
                                </div>
                            </label>
                        );
                    })
                )}
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <p className="text-xs font-medium text-neutral-600">{t('config.whatToChange')}</p>
                {(Object.keys(modeConfig) as AccessChangeMode[]).map((m) => (
                    <label key={m} className="flex items-start gap-2">
                        <input
                            type="radio"
                            name="access-mode"
                            checked={mode === m}
                            onChange={() => setMode(m)}
                            className="mt-0.5 text-primary-500"
                        />
                        <span className="text-xs text-neutral-700">
                            <strong>{modeConfig[m].label}</strong>
                            <span className="block text-2xs text-neutral-500">
                                {modeConfig[m].hint}
                            </span>
                        </span>
                    </label>
                ))}

                {needsDays && (
                    <div className="ml-6 mt-1 flex flex-col gap-1">
                        <label
                            htmlFor="access-days"
                            className="text-2xs font-medium text-neutral-600"
                        >
                            {mode === 'extend'
                                ? t('config.daysToAdd')
                                : t('config.totalDaysOfAccess')}
                        </label>
                        <Input
                            id="access-days"
                            type="number"
                            value={days}
                            onChange={(e) => setDays(e.target.value)}
                            className="h-8 w-36 text-xs"
                            min={mode === 'set_from_enrollment' ? 1 : undefined}
                        />
                        {mode === 'extend' && (
                            <p className="text-2xs text-neutral-500">{t('config.negativeHint')}</p>
                        )}
                    </div>
                )}

                {mode === 'set_date' && (
                    <div className="ml-6 mt-1 flex flex-col gap-1">
                        <label
                            htmlFor="access-expiry"
                            className="text-2xs font-medium text-neutral-600"
                        >
                            {t('config.newExpiryDate')}
                        </label>
                        <Input
                            id="access-expiry"
                            type="date"
                            value={expiryDate}
                            onChange={(e) => setExpiryDate(e.target.value)}
                            className="h-8 w-40 text-xs"
                        />
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-1">
                <label htmlFor="access-reason" className="text-xs font-medium text-neutral-600">
                    {t('config.reasonLabel')}
                </label>
                <Textarea
                    id="access-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('config.reasonPlaceholder')}
                    className="min-h-16 text-xs"
                />
                <p className="text-2xs text-neutral-500">{t('config.reasonHint')}</p>
            </div>
        </div>
    );

    const renderResultList = (data: LearnerAccessChangeResponse) => (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
            {data.results.map((r, idx) => {
                const course = r.package_session_id
                    ? courseByPSId.get(r.package_session_id)
                    : undefined;
                return (
                    <div
                        key={`${r.mapping_id ?? r.package_session_id ?? 'row'}-${idx}`}
                        className="rounded-lg border border-neutral-200 p-3"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium text-neutral-800">
                                {course?.package_name ||
                                    r.package_session_id ||
                                    t('resultList.enrollmentFallback')}
                            </p>
                            <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium ${
                                    r.status === 'UPDATED'
                                        ? 'bg-success-50 text-success-600'
                                        : r.status === 'SKIPPED'
                                          ? 'bg-neutral-100 text-neutral-500'
                                          : 'bg-danger-50 text-danger-600'
                                }`}
                            >
                                {r.status}
                            </span>
                        </div>
                        {r.status === 'UPDATED' ? (
                            <div className="mt-1 flex items-center gap-1.5 text-xs text-neutral-600">
                                <span>{formatExpiry(r.previous_expiry_date)}</span>
                                <ArrowRight className="size-3 text-neutral-400" />
                                <span className="font-medium text-neutral-800">
                                    {formatExpiry(r.new_expiry_date)}
                                </span>
                                {r.days_delta != null && (
                                    <span className="text-neutral-500">
                                        {t('resultList.daysDelta', {
                                            count: r.days_delta,
                                            sign: r.days_delta > 0 ? '+' : '',
                                        })}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <p className="mt-1 text-xs text-neutral-500">{r.message}</p>
                        )}
                    </div>
                );
            })}
        </div>
    );

    const renderPreview = () => (
        <div className="flex flex-col gap-4">
            <p className="text-sm text-neutral-600">
                {t('preview.willChange', { count: previewData?.summary.updated ?? 0 })},{' '}
                {t('preview.skippedCount', { count: previewData?.summary.skipped ?? 0 })}.{' '}
                {t('preview.notSaved')}
            </p>
            {previewData && renderResultList(previewData)}
        </div>
    );

    const renderResults = () => (
        <div className="flex flex-col gap-4">
            <p className="text-sm text-neutral-600">
                {t('results.updatedCount', { count: finalResults?.summary.updated ?? 0 })},{' '}
                {t('results.skippedCount', { count: finalResults?.summary.skipped ?? 0 })},{' '}
                {t('results.failedCount', { count: finalResults?.summary.failed ?? 0 })}.
            </p>
            {finalResults && renderResultList(finalResults)}
        </div>
    );

    const renderHistory = () => {
        if (isHistoryLoading) {
            return (
                <p className="py-6 text-center text-sm text-neutral-400">{t('history.loading')}</p>
            );
        }
        const entries = history?.content ?? [];
        if (entries.length === 0) {
            return (
                <p className="py-6 text-center text-sm text-neutral-400">{t('history.empty')}</p>
            );
        }
        return (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
                {entries.map((entry) => {
                    const course = entry.package_session_id
                        ? courseByPSId.get(entry.package_session_id)
                        : undefined;
                    return (
                        <div key={entry.id} className="rounded-lg border border-neutral-200 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-medium text-neutral-800">
                                    {course?.package_name ||
                                        entry.package_session_id ||
                                        t('resultList.enrollmentFallback')}
                                </p>
                                <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-2xs font-medium text-neutral-600">
                                    {entry.action}
                                </span>
                            </div>
                            <div className="mt-1 flex items-center gap-1.5 text-xs text-neutral-600">
                                <span>{formatExpiry(entry.previous_expiry_date)}</span>
                                <ArrowRight className="size-3 text-neutral-400" />
                                <span className="font-medium text-neutral-800">
                                    {formatExpiry(entry.new_expiry_date)}
                                </span>
                                {entry.days_delta != null && (
                                    <span className="text-neutral-500">
                                        {t('resultList.daysDelta', {
                                            count: entry.days_delta,
                                            sign: entry.days_delta > 0 ? '+' : '',
                                        })}
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 text-2xs text-neutral-500">
                                {format(new Date(entry.created_at), 'd MMM yyyy, h:mm a')} ·{' '}
                                {entry.source.replace(/_/g, ' ').toLowerCase()}
                                {entry.actor_name
                                    ? t('history.byActor', { name: entry.actor_name })
                                    : ''}
                            </p>
                            {entry.reason && (
                                <p className="mt-1 text-2xs italic text-neutral-500">
                                    {t('history.reasonQuote', { reason: entry.reason })}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    const footer = (
        <div className="flex w-full items-center justify-between gap-2">
            <MyButton
                buttonType="secondary"
                scale="medium"
                onClick={() => setStep(step === 'HISTORY' ? 'CONFIG' : 'HISTORY')}
                className="gap-1.5"
            >
                <ClockCounterClockwise className="size-4" />
                {step === 'HISTORY' ? t('footer.backToChanges') : t('footer.viewHistory')}
            </MyButton>

            <div className="flex items-center gap-2">
                {step === 'CONFIG' && (
                    <MyButton
                        scale="medium"
                        disable={!isConfigValid || isPending}
                        onClick={handlePreview}
                    >
                        {isPending ? t('footer.checking') : t('footer.previewChanges')}
                    </MyButton>
                )}
                {step === 'PREVIEW' && (
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setStep('CONFIG')}
                        >
                            {t('footer.back')}
                        </MyButton>
                        <MyButton
                            scale="medium"
                            disable={isPending || (previewData?.summary.updated ?? 0) === 0}
                            onClick={handleConfirm}
                        >
                            {isPending ? t('footer.applying') : t('footer.applyChanges')}
                        </MyButton>
                    </>
                )}
                {(step === 'RESULTS' || step === 'HISTORY') && (
                    <MyButton scale="medium" onClick={() => handleOpenChange(false)}>
                        {t('footer.done')}
                    </MyButton>
                )}
            </div>
        </div>
    );

    return (
        <MyDialog
            heading={t('dialogTitle')}
            open={open}
            onOpenChange={handleOpenChange}
            dialogWidth="max-w-lg"
            footer={footer}
        >
            {step === 'CONFIG' && renderConfig()}
            {step === 'PREVIEW' && renderPreview()}
            {step === 'RESULTS' && renderResults()}
            {step === 'HISTORY' && renderHistory()}
        </MyDialog>
    );
};

/** Pulls the server's message out of an axios error without leaking `any` into callers. */
const errorMessage = (err: unknown, fallback: string): string => {
    const response = (err as { response?: { data?: { message?: string } } })?.response;
    return response?.data?.message || fallback;
};
