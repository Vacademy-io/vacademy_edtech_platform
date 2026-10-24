import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowsClockwise,
    CheckCircle,
    Coins,
    FileX,
    Files,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { cn } from '@/lib/utils';
import {
    getCopyCheckConfig,
    previewSubmittedCheck,
    startSubmittedCheck,
    type CopyIntakeBatch,
} from '../../-services/copy-intake-services';
import {
    CommentPlacementPicker,
    useInstituteCommentPlacement,
} from '@/components/common/ai-copy-check/CommentPlacementPicker';
import {
    CopyCheckSettingsFields,
    toCopyCheckConfig,
    useCopyCheckSettings,
} from '@/components/common/ai-copy-check/CopyCheckSettingsFields';
import { CopyCheckCriteriaPanel } from '@/components/common/ai-copy-check/CopyCheckCriteriaPanel';

export const SUBMITTED_CHECK_PREVIEW_KEY = 'COPY_INTAKE_SUBMITTED_PREVIEW';

/**
 * Check the copies the learners submitted themselves, all at once.
 *
 * The other bulk dialog starts from PDFs the admin uploads; here every copy is
 * already on its student's attempt, so there is nothing to upload or match —
 * the server tells us how many copies are waiting (and how many are already
 * checked or being checked), quotes the cost, and queues them as one batch.
 * Progress lives in the same batch panel; email + bell when it settles.
 */
export const CheckSubmittedCopiesDialog = ({
    open,
    onOpenChange,
    assessmentId,
    instituteId,
    questionsPerCopy,
    attemptIds,
    onStarted,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assessmentId: string;
    instituteId: string;
    /** Questions on the paper — the unit the AI check is billed in. */
    questionsPerCopy: number;
    /** Checked rows of the submissions table; undefined/empty = every submitted copy. */
    attemptIds?: string[];
    onStarted: (batch: CopyIntakeBatch) => void;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const [includeChecked, setIncludeChecked] = useState(false);
    const [notifyEmail, setNotifyEmail] = useState(true);
    // Preselected from the institute's default (Settings → Assessment); the teacher can change it per batch.
    const [commentPlacement, setCommentPlacement] = useInstituteCommentPlacement(open);
    // Subject, marking instructions and language feedback: the assessment's own, else the institute's.
    const [copyCheckSettings, setCopyCheckSettings] = useCopyCheckSettings(open, () =>
        getCopyCheckConfig(assessmentId, instituteId)
    );
    const scoped = Boolean(attemptIds && attemptIds.length > 0);

    const preview = useQuery({
        queryKey: [SUBMITTED_CHECK_PREVIEW_KEY, assessmentId, attemptIds ?? [], includeChecked],
        queryFn: () =>
            previewSubmittedCheck(assessmentId, instituteId, {
                attempt_ids: scoped ? attemptIds : undefined,
                include_checked: includeChecked,
            }),
        enabled: open && Boolean(assessmentId && instituteId),
        staleTime: 0,
    });
    const p = preview.data;
    const toCheck = p?.to_check ?? 0;

    // Same charge the orchestrator records per completed copy, once per copy.
    const cost = useToolCostPreview(
        'copy_check_evaluation',
        { num_questions: questionsPerCopy },
        open && toCheck > 0,
        Math.max(toCheck, 1)
    );
    const rateLine = useMemo(() => {
        const row = cost.rate;
        if (!row) return null;
        const flat = Number(row.flat_base_credits) || 0;
        const perUnit = Number(row.per_unit_credits) || 0;
        const unit =
            row.unit_field === 'questions'
                ? t('dialog.unitQuestion')
                : row.unit_field === 'pages'
                  ? t('dialog.unitPage')
                  : null;
        if (!unit) return null;
        return t(flat > 0 ? 'dialog.rate' : 'dialog.rateNoBase', { flat, perUnit, unit });
    }, [cost.rate, t]);

    const start = useMutation({
        mutationFn: () =>
            startSubmittedCheck(assessmentId, instituteId, {
                attempt_ids: scoped ? attemptIds : undefined,
                include_checked: includeChecked,
                // No preferred_model: the platform's evaluation default applies.
                notify_email: notifyEmail,
                comment_placement: commentPlacement,
                copy_check_config: toCopyCheckConfig(copyCheckSettings),
            }),
        onSuccess: (batch) => {
            toast.success(t('submitted.toastStarted', { count: batch.total_items }));
            onOpenChange(false);
            onStarted(batch);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('errors.startFailed')),
    });

    const canStart =
        toCheck > 0 && !preview.isFetching && !start.isPending && cost.sufficient !== false;

    return (
        <MyDialog
            heading={t('submitted.title')}
            open={open}
            onOpenChange={(next) => {
                if (start.isPending) return;
                onOpenChange(next);
            }}
            dialogWidth="max-w-xl"
        >
            <div className="flex flex-col gap-4 p-4 sm:p-6">
                <p className="text-sm text-neutral-600">
                    {scoped
                        ? t('submitted.introSelected', { count: attemptIds?.length ?? 0 })
                        : t('submitted.introAll')}
                </p>

                {preview.isLoading ? (
                    <DashboardLoader height="6rem" />
                ) : preview.isError || !p ? (
                    <p className="flex items-start gap-2 rounded-md bg-danger-50 p-3 text-sm text-danger-700">
                        <WarningCircle size={18} className="mt-px shrink-0" />
                        {t('submitted.previewFailed')}
                    </p>
                ) : (
                    <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 text-sm">
                        <Row
                            icon={<Files size={18} className="text-primary-500" />}
                            label={t('submitted.withCopy', { count: p.with_copy })}
                            hint={
                                p.no_copy > 0
                                    ? t('submitted.noCopy', { count: p.no_copy })
                                    : undefined
                            }
                        />
                        {p.already_checked > 0 && (
                            <Row
                                icon={<CheckCircle size={18} className="text-success-600" />}
                                label={t('submitted.alreadyChecked', { count: p.already_checked })}
                                hint={
                                    includeChecked
                                        ? t('submitted.willRecheck')
                                        : t('submitted.skipped')
                                }
                            />
                        )}
                        {p.in_progress > 0 && (
                            <Row
                                icon={
                                    <ArrowsClockwise
                                        size={18}
                                        className="animate-spin text-primary-500"
                                    />
                                }
                                label={t('submitted.inProgress', { count: p.in_progress })}
                                hint={t('submitted.notTwice')}
                            />
                        )}
                        <Row
                            icon={
                                toCheck > 0 ? (
                                    <Sparkle size={18} weight="fill" className="text-primary-500" />
                                ) : (
                                    <FileX size={18} className="text-neutral-400" />
                                )
                            }
                            label={
                                toCheck > 0
                                    ? t('submitted.toCheck', { count: toCheck })
                                    : t('submitted.nothingToCheck')
                            }
                            emphasis
                        />
                    </ul>
                )}

                {p && p.already_checked > 0 && (
                    <label className="flex items-center gap-2 text-sm text-neutral-700">
                        <Checkbox
                            checked={includeChecked}
                            onCheckedChange={(v) => setIncludeChecked(v === true)}
                        />
                        {t('submitted.includeChecked', { count: p.already_checked })}
                    </label>
                )}

                <div
                    className={cn(
                        'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm',
                        cost.sufficient === false
                            ? 'border-danger-200 bg-danger-50 text-danger-700'
                            : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                    )}
                >
                    <span className="flex items-center gap-2">
                        <Coins size={16} className="text-primary-500" />
                        {toCheck === 0
                            ? t('submitted.costEmpty')
                            : cost.credits == null
                              ? t('dialog.counting')
                              : t('dialog.cost', {
                                    count: toCheck,
                                    questions: questionsPerCopy,
                                    credits: cost.credits,
                                })}
                    </span>
                    {cost.currentBalance != null && (
                        <span className="text-caption text-neutral-500">
                            {t('dialog.balance', { count: cost.currentBalance })}
                        </span>
                    )}
                    {rateLine && toCheck > 0 && (
                        <span className="basis-full text-caption text-neutral-500">{rateLine}</span>
                    )}
                </div>
                {cost.sufficient === false && (
                    <p className="flex items-start gap-2 text-caption text-danger-600">
                        <WarningCircle size={16} className="mt-px shrink-0" />
                        {t('dialog.insufficient')}
                    </p>
                )}

                <CommentPlacementPicker
                    value={commentPlacement}
                    onChange={setCommentPlacement}
                    disabled={start.isPending}
                />

                <CopyCheckSettingsFields
                    value={copyCheckSettings}
                    onChange={setCopyCheckSettings}
                    disabled={start.isPending}
                />

                <CopyCheckCriteriaPanel
                    assessmentId={assessmentId}
                    subject={copyCheckSettings.subject}
                    disabled={start.isPending}
                />

                <label className="flex items-center gap-2 text-sm text-neutral-700">
                    <Checkbox
                        checked={notifyEmail}
                        onCheckedChange={(v) => setNotifyEmail(v === true)}
                    />
                    {t('dialog.notifyEmail')}
                </label>

                <div className="flex justify-end gap-2 border-t border-neutral-200 pt-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={start.isPending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={!canStart}
                        onClick={() => start.mutate()}
                    >
                        {start.isPending
                            ? t('submitted.starting')
                            : t('dialog.start', { count: toCheck })}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
};

const Row = ({
    icon,
    label,
    hint,
    emphasis,
}: {
    icon: React.ReactNode;
    label: string;
    hint?: string;
    emphasis?: boolean;
}) => (
    <li className="flex items-start gap-3 px-3 py-2">
        <span className="mt-px shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
            <span
                className={cn(
                    'block',
                    emphasis ? 'font-semibold text-neutral-900' : 'text-neutral-800'
                )}
            >
                {label}
            </span>
            {hint && <span className="block text-caption text-neutral-500">{hint}</span>}
        </span>
    </li>
);

export default CheckSubmittedCopiesDialog;
