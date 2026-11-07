import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ArrowRight } from '@phosphor-icons/react';
import { getInstituteId } from '@/constants/helper';
import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import {
    buildAccessChangePayload,
    useChangeLearnerAccessMutation,
    type AccessChangeMode,
    type LearnerAccessChangeRequest,
    type LearnerAccessChangeResponse,
} from '@/routes/manage-students/students-list/-services/learner-access';

type Step = 'CONFIG' | 'PREVIEW' | 'RESULTS';

/**
 * Bulk course-access change for every selected learner.
 *
 * <p>Only the three modes that are meaningful across a mixed selection are offered.
 * "Set total days from enrollment" is deliberately absent: each learner enrolled on a
 * different date, so it would silently hand them different end dates.
 */
/** Mode labels/hints are display-only — the record key itself stays the untranslated
 *  AccessChangeMode value used for dispatch/comparison/payload logic below. */
const buildModeConfig = (
    t: TFunction
): Record<Exclude<AccessChangeMode, 'set_from_enrollment'>, { label: string; hint: string }> => ({
    extend: { label: t('modes.extend.label'), hint: t('modes.extend.hint') },
    set_date: { label: t('modes.setDate.label'), hint: t('modes.setDate.hint') },
    unlimited: { label: t('modes.unlimited.label'), hint: t('modes.unlimited.hint') },
});

export const BulkExtendAccessDialog = ({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const { t } = useTranslation('manageStudentsBulkExtendAccessDialog');
    const instituteId = getInstituteId() || '';
    const { bulkActionInfo, closeAllDialogs } = useDialogStore();

    const [step, setStep] = useState<Step>('CONFIG');
    const [mode, setMode] = useState<Exclude<AccessChangeMode, 'set_from_enrollment'>>('extend');
    const [days, setDays] = useState('30');
    const [expiryDate, setExpiryDate] = useState('');
    const [reason, setReason] = useState('');
    // Optional and independent of the expiry mode: an admin may move only the join date
    // (a learner who cannot start this intake), only the expiry, or both at once.
    const [joinDate, setJoinDate] = useState('');
    const [allCourses, setAllCourses] = useState(false);
    const [previewData, setPreviewData] = useState<LearnerAccessChangeResponse | null>(null);
    const [finalResults, setFinalResults] = useState<LearnerAccessChangeResponse | null>(null);

    const { mutateAsync: changeAccess, isPending } = useChangeLearnerAccessMutation();

    const modeConfig = useMemo(() => buildModeConfig(t), [t]);

    const formatExpiry = (value: string | null | undefined) =>
        value ? format(new Date(value), 'd MMM yyyy') : t('unlimitedLabel');

    const learners = (bulkActionInfo?.selectedStudents ?? []).filter((s) => s?.user_id);
    const userIds = Array.from(new Set(learners.map((s) => s.user_id)));
    // The rows the admin selected are already scoped to a batch by the list's filters, so
    // default to exactly those package sessions rather than silently touching every course
    // the learner happens to be enrolled in.
    const packageSessionIds = Array.from(
        new Set(learners.map((s) => s.package_session_id).filter(Boolean))
    );

    const handleOpenChange = (isOpen: boolean) => {
        if (isOpen) {
            setStep('CONFIG');
            setMode('extend');
            setDays('30');
            setExpiryDate('');
            setReason('');
            setAllCourses(false);
            setPreviewData(null);
            setFinalResults(null);
            setJoinDate('');
        }
        onOpenChange(isOpen);
    };

    const numericDays = parseInt(days, 10);
    const isValid =
        userIds.length > 0 &&
        // A join-date move stands on its own: no expiry operation has to be chosen with it.
        (Boolean(joinDate) ||
            mode === 'unlimited' ||
            (mode === 'set_date' && Boolean(expiryDate)) ||
            (mode === 'extend' && Number.isFinite(numericDays) && numericDays !== 0));

    const buildRequest = (dryRun: boolean): LearnerAccessChangeRequest => ({
        institute_id: instituteId,
        user_ids: userIds,
        package_session_ids: allCourses ? [] : packageSessionIds,
        ...buildAccessChangePayload({
            mode,
            days: mode === 'extend' ? numericDays : undefined,
            // End-of-day local, so the final day stays usable rather than being cut at midnight.
            expiryDate: expiryDate ? new Date(`${expiryDate}T23:59:59`).toISOString() : undefined,
        }),
        // Midday local, so the stored instant lands on the intended calendar day in every
        // timezone rather than slipping a day either side of midnight.
        new_join_date: joinDate ? new Date(`${joinDate}T12:00:00`).toISOString() : undefined,
        reason: reason.trim() || undefined,
        dry_run: dryRun,
    });

    const errorMessage = (err: unknown, fallback: string) =>
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        fallback;

    const handlePreview = async () => {
        try {
            setPreviewData(await changeAccess(buildRequest(true)));
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
            if (result.summary.updated > 0) {
                toast.success(t('toasts.accessUpdated', { count: result.summary.updated }));
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
                    count={userIds.length}
                    components={{ strong: <strong /> }}
                />
            </p>

            <div className="flex flex-col gap-2 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <p className="text-caption font-medium text-neutral-600">
                    {t('config.whatToChange')}
                </p>
                {(Object.keys(modeConfig) as Array<keyof typeof modeConfig>).map((m) => (
                    <label key={m} className="flex items-start gap-2">
                        <input
                            type="radio"
                            name="bulk-access-mode"
                            checked={mode === m}
                            onChange={() => setMode(m)}
                            className="mt-0.5 text-primary-500"
                        />
                        <span className="text-caption text-neutral-700">
                            <strong>{modeConfig[m].label}</strong>
                            <span className="block text-2xs text-neutral-500">
                                {modeConfig[m].hint}
                            </span>
                        </span>
                    </label>
                ))}

                {mode === 'extend' && (
                    <div className="ml-6 mt-1 flex flex-col gap-1">
                        <label
                            htmlFor="bulk-days"
                            className="text-2xs font-medium text-neutral-600"
                        >
                            {t('config.daysToAdd')}
                        </label>
                        <Input
                            id="bulk-days"
                            type="number"
                            value={days}
                            onChange={(e) => setDays(e.target.value)}
                            className="h-8 w-36 text-caption"
                        />
                        <p className="text-2xs text-neutral-500">{t('config.negativeHint')}</p>
                    </div>
                )}

                {mode === 'set_date' && (
                    <div className="ml-6 mt-1 flex flex-col gap-1">
                        <label
                            htmlFor="bulk-expiry"
                            className="text-2xs font-medium text-neutral-600"
                        >
                            {t('config.newExpiryDate')}
                        </label>
                        <Input
                            id="bulk-expiry"
                            type="date"
                            value={expiryDate}
                            onChange={(e) => setExpiryDate(e.target.value)}
                            className="h-8 w-40 text-caption"
                        />
                    </div>
                )}
            </div>

            <label className="flex items-start gap-2">
                <Checkbox
                    checked={allCourses}
                    onCheckedChange={(v) => setAllCourses(v === true)}
                    className="mt-0.5"
                />
                <span className="text-caption text-neutral-700">
                    <Trans
                        t={t}
                        i18nKey="config.applyToEveryCourse"
                        components={{ strong: <strong /> }}
                    />
                    <span className="block text-2xs text-neutral-500">
                        {t('config.batchesHint', { count: packageSessionIds.length })}
                    </span>
                </span>
            </label>

            <div className="flex flex-col gap-1">
                <label htmlFor="bulk-join-date" className="text-caption font-medium text-neutral-600">
                    Join date (optional)
                </label>
                <Input
                    id="bulk-join-date"
                    type="date"
                    value={joinDate}
                    onChange={(e) => setJoinDate(e.target.value)}
                />
                <p className="text-2xs text-neutral-500">
                    Moves when the learner joined. Their plan term and next charge date shift with
                    it, so a trial starting a week later also ends — and is billed — a week later.
                </p>

                <label htmlFor="bulk-reason" className="text-caption font-medium text-neutral-600">
                    {t('config.reasonLabel')}
                </label>
                <Textarea
                    id="bulk-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('config.reasonPlaceholder')}
                    className="min-h-16 text-caption"
                />
                <p className="text-2xs text-neutral-500">{t('config.reasonHint')}</p>
            </div>
        </div>
    );

    const renderResultList = (data: LearnerAccessChangeResponse) => (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
            {data.results.map((r, idx) => (
                <div
                    key={`${r.mapping_id ?? idx}`}
                    className="rounded-lg border border-neutral-200 p-3"
                >
                    <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-caption font-medium text-neutral-800">
                            {r.learner_name || r.user_id}
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
                        <div className="mt-1 flex items-center gap-1.5 text-2xs text-neutral-600">
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
                        <p className="mt-1 text-2xs text-neutral-500">{r.message}</p>
                    )}
                </div>
            ))}
        </div>
    );

    const summaryLine = (d: LearnerAccessChangeResponse | null, ns: 'preview' | 'results') =>
        t(`${ns}.summaryLine`, {
            count: d?.summary.updated ?? 0,
            skipped: d?.summary.skipped ?? 0,
            failed: d?.summary.failed ?? 0,
        });

    const footer = (
        <div className="flex items-center gap-2">
            {step === 'CONFIG' && (
                <MyButton scale="medium" disable={!isValid || isPending} onClick={handlePreview}>
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
            {step === 'RESULTS' && (
                <MyButton
                    scale="medium"
                    onClick={() => {
                        handleOpenChange(false);
                        closeAllDialogs();
                    }}
                >
                    {t('footer.done')}
                </MyButton>
            )}
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
            {step === 'PREVIEW' && (
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-neutral-600">
                        {summaryLine(previewData, 'preview')} {t('preview.notSaved')}
                    </p>
                    {previewData && renderResultList(previewData)}
                </div>
            )}
            {step === 'RESULTS' && (
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-neutral-600">
                        {summaryLine(finalResults, 'results')}
                    </p>
                    {finalResults && renderResultList(finalResults)}
                </div>
            )}
        </MyDialog>
    );
};
