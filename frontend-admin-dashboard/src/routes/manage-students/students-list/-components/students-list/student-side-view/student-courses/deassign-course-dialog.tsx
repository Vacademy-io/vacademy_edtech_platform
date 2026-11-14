import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarBlank } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import { useBulkDeassign } from '@/routes/manage-students/students-list/-services/bulkAssignService';
import type {
    BulkDeassignRequest,
    BulkDeassignResponse,
} from '@/routes/manage-students/students-list/-types/bulk-assign-types';
import type { PackageDetailDTO } from '@/routes/manage-students/students-list/-services/getLearnerPackages';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    DEFAULT_TERMINATION_REASON_SETTING,
    useTerminationReasonSetting,
} from '@/services/termination-reason-setting';
import { useCanDeletePayments } from '@/routes/manage-payments/-hooks/useCanDeletePayments';

type DeassignStep = 'CONFIG' | 'PREVIEW' | 'RESULTS';

interface DeassignCourseDialogProps {
    userId: string;
    userName: string;
    courses: PackageDetailDTO[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export const DeassignCourseDialog = ({
    userId,
    userName,
    courses,
    open,
    onOpenChange,
    onSuccess,
}: DeassignCourseDialogProps) => {
    const { t } = useTranslation('manageStudentsDeassignCourseDialog');
    const instituteId = getInstituteId() || '';
    const [step, setStep] = useState<DeassignStep>('CONFIG');
    const [selectedPSIds, setSelectedPSIds] = useState<Set<string>>(new Set());
    const [mode, setMode] = useState<'SOFT' | 'HARD'>('SOFT');
    const [notifyLearners, setNotifyLearners] = useState(false);
    // SOFT-only "last access date" override. null → respect the plan's own expiry.
    // A yyyy-MM-dd string once the admin picks a date from the calendar.
    const [accessTillDate, setAccessTillDate] = useState<string | null>(null);
    // HARD-only. Shown/required per the institute's Termination Reason setting.
    const [reason, setReason] = useState('');
    // HARD-only, and only offered to roles allowed to delete payments.
    const [deleteHistory, setDeleteHistory] = useState(false);
    const [previewData, setPreviewData] = useState<BulkDeassignResponse | null>(null);
    const [finalResults, setFinalResults] = useState<BulkDeassignResponse | null>(null);

    const { mutateAsync: bulkDeassign, isPending } = useBulkDeassign();
    const { data: reasonSetting = DEFAULT_TERMINATION_REASON_SETTING } =
        useTerminationReasonSetting();
    const askReason = mode === 'HARD' && reasonSetting.enabled;
    const reasonMissing = askReason && reasonSetting.required && !reason.trim();
    const canDeletePayments = useCanDeletePayments();
    const deletingHistory = mode === 'HARD' && canDeletePayments && deleteHistory;
    const queryClient = useQueryClient();

    // Reset when dialog opens
    const handleOpenChange = (isOpen: boolean) => {
        if (isOpen) {
            setStep('CONFIG');
            setSelectedPSIds(new Set());
            setMode('SOFT');
            setNotifyLearners(false);
            setAccessTillDate(null);
            setReason('');
            setDeleteHistory(false);
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

    // Latest plan-expiry among the selected courses — the SOFT "last access date"
    // defaults to this (learner keeps access until their plan would have expired).
    const defaultExpiry: Date | null = (() => {
        const dates = Array.from(selectedPSIds)
            .map((psId) => courses.find((c) => c.package_session_id === psId)?.expiry_date)
            .filter((d): d is string => !!d)
            .map((d) => new Date(d))
            .filter((d) => !isNaN(d.getTime()));
        if (dates.length === 0) return null;
        return dates.reduce((a, b) => (a > b ? a : b));
    })();

    const buildRequest = (dryRun: boolean): BulkDeassignRequest => ({
        institute_id: instituteId,
        user_ids: [userId],
        package_session_ids: Array.from(selectedPSIds),
        options: {
            mode,
            notify_learners: notifyLearners,
            dry_run: dryRun,
            // Only meaningful for SOFT; sent only when the admin overrode the
            // default plan-expiry with an explicit last-access date.
            access_till_date: mode === 'SOFT' ? accessTillDate : null,
            reason: askReason && reason.trim() ? reason.trim() : null,
            delete_payment_history: deletingHistory,
        },
    });

    const handlePreview = async () => {
        try {
            const result = await bulkDeassign(buildRequest(true));
            setPreviewData(result);
            setStep('PREVIEW');
        } catch (err: any) {
            toast.error(err?.response?.data?.message || t('toasts.previewFailed'));
        }
    };

    const handleConfirm = async () => {
        try {
            const result = await bulkDeassign(buildRequest(false));
            setFinalResults(result);
            setStep('RESULTS');
            if (deletingHistory && result.summary.successful > 0) {
                // The payment views cache their data; drop it so the deleted history
                // is gone the moment the admin looks, not after a refresh.
                [
                    'user-invoices',
                    'user-account-summary',
                    'user-account-ledger',
                    'cpo-side-view',
                    'payment-billing-summary',
                ].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
            }
            if (result.summary.failed === 0) {
                toast.success(
                    t('toasts.deassignSuccess', { count: result.summary.successful })
                );
                onSuccess();
            } else {
                toast.warning(
                    t('toasts.deassignPartial', {
                        successful: result.summary.successful,
                        failed: result.summary.failed,
                    })
                );
            }
        } catch (err: any) {
            toast.error(err?.response?.data?.message || t('toasts.deassignFailed'));
        }
    };

    const renderConfig = () => (
        <div className="flex flex-col gap-5">
            <p className="text-sm text-neutral-600">
                <Trans
                    t={t}
                    i18nKey="config.removePrompt"
                    values={{ name: userName }}
                    components={{ strong: <strong /> }}
                />
            </p>

            {/* Course selection */}
            <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pe-1">
                {courses.length === 0 ? (
                    <p className="py-4 text-center text-sm text-neutral-400">
                        {t('config.noCourses')}
                    </p>
                ) : (
                    courses.map((c) => {
                        const psId = c.package_session_id;
                        if (!psId) return null;
                        const checked = selectedPSIds.has(psId);
                        return (
                            <label
                                key={c.id}
                                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all ${
                                    checked
                                        ? 'border-red-300 bg-red-50/40'
                                        : 'border-neutral-200 hover:border-neutral-300'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePS(psId)}
                                    className="h-4 w-4 rounded border-neutral-300 text-red-500 focus:ring-red-300"
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-neutral-800">
                                        {c.package_name || t('config.unnamedCourse')}
                                    </p>
                                    {c.level_name && (
                                        <p className="truncate text-xs text-neutral-500">
                                            {c.level_name}
                                        </p>
                                    )}
                                </div>
                            </label>
                        );
                    })
                )}
            </div>

            {/* Mode selection */}
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <p className="text-xs font-medium text-neutral-600">{t('config.removalMode')}</p>
                <label className="flex items-start gap-2">
                    <input
                        type="radio"
                        name="mode"
                        checked={mode === 'SOFT'}
                        onChange={() => setMode('SOFT')}
                        className="mt-0.5 text-primary-500"
                    />
                    <span className="text-xs text-neutral-700">
                        <strong>{t('config.softCancel.label')}</strong>{' '}
                        {t('config.softCancel.description')}
                    </span>
                </label>

                {/* SOFT-only: last access date. Defaults to the plan's expiry;
                    the calendar lets the admin bring the access cut-off forward. */}
                {mode === 'SOFT' && (
                    <div className="ml-6 mt-1 flex flex-col gap-1.5">
                        <p className="text-2xs font-medium text-neutral-600">
                            {t('config.lastAccessDate.label')}
                        </p>
                        <div className="flex items-center gap-1.5">
                            {/* Typed entry. yyyy-MM-dd is exactly the shape accessTillDate
                                holds and the API expects, so the value maps straight through
                                with no parsing. Also gives the browser's own picker, which
                                renders natively and can never be clipped by the dialog. */}
                            <Input
                                type="date"
                                aria-label={t('config.lastAccessDate.ariaLabel')}
                                value={accessTillDate ?? ''}
                                onChange={(e) => setAccessTillDate(e.target.value || null)}
                                className="h-8 w-36 text-xs"
                            />
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label={t('config.lastAccessDate.pickAriaLabel')}
                                        className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-600 transition-colors hover:border-neutral-300"
                                    >
                                        <CalendarBlank className="size-3.5 text-neutral-400" />
                                    </button>
                                </PopoverTrigger>
                                {/* Portalled (the default) rather than inline: MyDialog wraps its
                                    body in a vertical scroll area inside a capped-height,
                                    overflow-hidden shell, so an inline popover gets clipped —
                                    a 6-row month lost its last week. The popover has no internal
                                    scrolling, so the reason PopoverContent offers the inline
                                    escape hatch doesn't apply here. Stacking is left to DOM
                                    order: the portal mounts after the dialog, so at equal
                                    z-index it still paints above it. */}
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        // Always render 6 week rows so the height is identical
                                        // in every month — no reflow, nothing to clip.
                                        fixedWeeks
                                        selected={
                                            accessTillDate
                                                ? new Date(accessTillDate)
                                                : defaultExpiry ?? undefined
                                        }
                                        defaultMonth={
                                            accessTillDate
                                                ? new Date(accessTillDate)
                                                : defaultExpiry ?? undefined
                                        }
                                        onSelect={(date) => {
                                            if (date) setAccessTillDate(format(date, 'yyyy-MM-dd'));
                                        }}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <p className="text-2xs text-neutral-400">
                            {accessTillDate
                                ? t('config.lastAccessDate.hintSelected')
                                : defaultExpiry
                                  ? t('config.lastAccessDate.hintDefaultWithDate', {
                                        date: format(defaultExpiry, 'dd MMM yyyy'),
                                    })
                                  : t('config.lastAccessDate.hintDefaultNoDate')}
                            {accessTillDate && (
                                <button
                                    type="button"
                                    onClick={() => setAccessTillDate(null)}
                                    className="ml-1.5 text-primary-500 hover:underline"
                                >
                                    {t('config.lastAccessDate.reset')}
                                </button>
                            )}
                        </p>
                    </div>
                )}
                <label className="flex items-start gap-2">
                    <input
                        type="radio"
                        name="mode"
                        checked={mode === 'HARD'}
                        onChange={() => setMode('HARD')}
                        className="mt-0.5 text-red-500"
                    />
                    <span className="text-xs text-neutral-700">
                        <strong>{t('config.hardTerminate.label')}</strong>{' '}
                        {t('config.hardTerminate.description')}
                        <span className="ms-1 text-red-500">
                            {t('config.hardTerminate.cannotUndo')}
                        </span>
                    </span>
                </label>

                {askReason && (
                    <div className="ml-6 mt-1 flex flex-col gap-1.5">
                        <label
                            htmlFor="termination-reason"
                            className="text-2xs font-medium text-neutral-600"
                        >
                            {t('config.reason.label')}
                            {reasonSetting.required ? (
                                <span className="ms-0.5 text-red-500">*</span>
                            ) : (
                                <span className="ms-1 font-normal text-neutral-400">
                                    {t('config.reason.optional')}
                                </span>
                            )}
                        </label>
                        <Textarea
                            id="termination-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t('config.reason.placeholder')}
                            maxLength={1000}
                            rows={3}
                            className="text-xs"
                        />
                    </div>
                )}

                {mode === 'HARD' && canDeletePayments && (
                    <label className="ml-6 mt-1 flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-2">
                        <input
                            type="checkbox"
                            checked={deleteHistory}
                            onChange={(e) => setDeleteHistory(e.target.checked)}
                            className="mt-0.5 size-3.5 rounded border-neutral-300 text-red-500"
                        />
                        <span className="flex flex-col gap-0.5 text-xs text-neutral-700">
                            <strong>{t('config.deletePaymentHistory.label')}</strong>
                            <span className="text-2xs text-neutral-500">
                                {t('config.deletePaymentHistory.description')}
                            </span>
                            {deleteHistory && (
                                <span className="text-2xs text-red-500">
                                    ⚠ {t('config.deletePaymentHistory.warning')}
                                </span>
                            )}
                        </span>
                    </label>
                )}

                <label className="mt-1 flex items-center gap-2 text-xs text-neutral-600">
                    <input
                        type="checkbox"
                        checked={notifyLearners}
                        onChange={(e) => setNotifyLearners(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-500"
                    />
                    {t('config.notifyLearners')}
                </label>
            </div>
        </div>
    );

    const renderPreview = () => {
        if (!previewData) return null;
        const { summary, results } = previewData;
        return (
            <div className="flex flex-col gap-4">
                <p className="text-sm font-medium text-neutral-700">{t('preview.title')}</p>

                {askReason && reason.trim() && (
                    <p className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-xs text-neutral-700">
                        <strong>{t('preview.reason')}</strong> {reason.trim()}
                    </p>
                )}

                <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                        ✅ {t('preview.willBeRemoved', { count: summary.successful })}
                    </span>
                    {summary.skipped > 0 && (
                        <span className="rounded-full bg-yellow-50 px-3 py-1 text-xs font-medium text-yellow-700">
                            ⏭ {t('preview.skipped', { count: summary.skipped })}
                        </span>
                    )}
                    {summary.failed > 0 && (
                        <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                            ❌ {t('preview.failed', { count: summary.failed })}
                        </span>
                    )}
                </div>

                <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-200">
                    <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-neutral-50">
                            <tr>
                                <th className="px-3 py-2 font-medium text-neutral-600">
                                    {t('preview.tableHeaders.course')}
                                </th>
                                <th className="px-3 py-2 font-medium text-neutral-600">
                                    {t('preview.tableHeaders.action')}
                                </th>
                                <th className="px-3 py-2 font-medium text-neutral-600">
                                    {t('preview.tableHeaders.status')}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                            {results.map((r, idx) => {
                                const course = courses.find(
                                    (c) => c.package_session_id === r.package_session_id
                                );
                                return (
                                    <tr
                                        key={idx}
                                        className={
                                            r.warning
                                                ? 'bg-yellow-50/50'
                                                : r.status === 'FAILED'
                                                  ? 'bg-red-50/50'
                                                  : ''
                                        }
                                    >
                                        <td className="px-3 py-2 text-neutral-800">
                                            {course?.package_name || r.package_session_id}
                                        </td>
                                        <td className="px-3 py-2 text-neutral-500">
                                            {r.action_taken}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={`inline-block rounded-full px-2 py-0.5 text-2xs font-medium ${
                                                    r.status === 'SUCCESS'
                                                        ? 'bg-green-100 text-green-700'
                                                        : r.status === 'SKIPPED'
                                                          ? 'bg-yellow-100 text-yellow-700'
                                                          : 'bg-red-100 text-red-700'
                                                }`}
                                            >
                                                {r.status}
                                            </span>
                                            {r.warning && (
                                                <p className="mt-0.5 text-2xs text-amber-600">
                                                    ⚠ {r.warning}
                                                </p>
                                            )}
                                            {r.message && (
                                                <p className="mt-0.5 text-2xs text-neutral-400">
                                                    {r.message}
                                                </p>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderResults = () => {
        if (!finalResults) return null;
        const { summary, results } = finalResults;
        return (
            <div className="flex flex-col gap-4">
                <p className="text-sm font-semibold text-neutral-800">{t('results.title')}</p>
                <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                        ✅ {t('results.removed', { count: summary.successful })}
                    </span>
                    {summary.skipped > 0 && (
                        <span className="rounded-full bg-yellow-50 px-3 py-1 text-xs font-medium text-yellow-700">
                            ⏭ {t('results.skipped', { count: summary.skipped })}
                        </span>
                    )}
                    {summary.failed > 0 && (
                        <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                            ❌ {t('results.failed', { count: summary.failed })}
                        </span>
                    )}
                </div>

                <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-200">
                    <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-neutral-50">
                            <tr>
                                <th className="px-3 py-2 font-medium text-neutral-600">
                                    {t('results.tableHeaders.course')}
                                </th>
                                <th className="px-3 py-2 font-medium text-neutral-600">
                                    {t('results.tableHeaders.status')}
                                </th>
                                <th className="px-3 py-2 font-medium text-neutral-600">
                                    {t('results.tableHeaders.message')}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                            {results.map((r, idx) => {
                                const course = courses.find(
                                    (c) => c.package_session_id === r.package_session_id
                                );
                                return (
                                    <tr key={idx}>
                                        <td className="px-3 py-2 text-neutral-800">
                                            {course?.package_name || r.package_session_id}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={`inline-block rounded-full px-2 py-0.5 text-2xs font-medium ${
                                                    r.status === 'SUCCESS'
                                                        ? 'bg-green-100 text-green-700'
                                                        : r.status === 'SKIPPED'
                                                          ? 'bg-yellow-100 text-yellow-700'
                                                          : 'bg-red-100 text-red-700'
                                                }`}
                                            >
                                                {r.status}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-neutral-500">
                                            {r.message || '—'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const footer = (
        <div className="flex w-full items-center justify-between">
            {step === 'CONFIG' && (
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => handleOpenChange(false)}
                    >
                        {t('footer.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={selectedPSIds.size === 0 || reasonMissing || isPending}
                        onClick={handlePreview}
                        className="!bg-red-500 hover:!bg-red-600"
                    >
                        {isPending
                            ? t('footer.loading')
                            : t('footer.previewButton', { count: selectedPSIds.size })}
                    </MyButton>
                </>
            )}
            {step === 'PREVIEW' && (
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setStep('CONFIG')}
                    >
                        {t('footer.back')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={isPending}
                        onClick={handleConfirm}
                        className="!bg-red-500 hover:!bg-red-600"
                    >
                        {isPending ? t('footer.removing') : t('footer.confirmRemoval')}
                    </MyButton>
                </>
            )}
            {step === 'RESULTS' && (
                <MyButton
                    buttonType="primary"
                    scale="small"
                    onClick={() => handleOpenChange(false)}
                    className="ml-auto"
                >
                    {t('footer.done')}
                </MyButton>
            )}
        </div>
    );

    return (
        <MyDialog
            heading={t('dialogTitle', {
                term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
            })}
            open={open}
            onOpenChange={handleOpenChange}
            dialogWidth="max-w-lg"
            footer={footer}
        >
            {step === 'CONFIG' && renderConfig()}
            {step === 'PREVIEW' && renderPreview()}
            {step === 'RESULTS' && renderResults()}
        </MyDialog>
    );
};
