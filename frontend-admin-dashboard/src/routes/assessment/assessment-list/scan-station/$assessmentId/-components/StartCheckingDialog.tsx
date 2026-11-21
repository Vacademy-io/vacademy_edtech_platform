import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Coins, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
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
import { cn } from '@/lib/utils';
import { getCopyCheckConfig } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/copy-intake-services';
import {
    startScanSession,
    type ScanSession,
    type ScanStartResponse,
} from '../-services/scan-station-services';
import { apiErrorMessage, apiErrorStatus, isPlanChanged } from '../-lib/api-error';
import { scanSessionKey, useOnScanNotFound } from '../-hooks/useScanActions';

/**
 * The last step: the same choices as "Upload copies" (where remarks go, subject
 * and marking instructions, the criteria, email when done) and the credit quote
 * for the built pages, then the built copies go to copy intake. Copies are
 * always matched to students by the name on them.
 */
export const StartCheckingDialog = ({
    open,
    onOpenChange,
    session,
    assessmentId,
    instituteId,
    onStarted,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    session: ScanSession;
    assessmentId: string;
    instituteId: string;
    onStarted: (result: ScanStartResponse) => void;
}) => {
    const { t } = useTranslation('scanStation');
    const queryClient = useQueryClient();
    const onNotFound = useOnScanNotFound(instituteId);
    const [notifyEmail, setNotifyEmail] = useState(true);
    const [commentPlacement, setCommentPlacement] = useInstituteCommentPlacement(open);
    const [copyCheckSettings, setCopyCheckSettings] = useCopyCheckSettings(open, () =>
        getCopyCheckConfig(assessmentId, instituteId)
    );

    const built = session.built ?? [];
    const copies = built.length;
    const pages = built.reduce((sum, b) => sum + b.page_count, 0);
    // Charged per copy, like the upload dialog: each copy's pages, once per copy.
    const cost = useToolCostPreview(
        'copy_check_evaluation',
        { num_pages: copies > 0 ? pages / copies : 0 },
        open && copies > 0,
        copies
    );

    const start = useMutation({
        mutationFn: () =>
            startScanSession(session.id, instituteId, {
                preferred_model: null,
                notify_email: notifyEmail,
                comment_placement: commentPlacement,
                copy_check_config: toCopyCheckConfig(copyCheckSettings),
                map_students: true,
            }),
        onSuccess: (result) => {
            toast.success(t('start.started', { count: result.batch.total_items }));
            onOpenChange(false);
            onStarted(result);
        },
        onError: (e) => {
            if (onNotFound(e)) {
                toast.error(t('start.failed'));
                onOpenChange(false);
                return;
            }
            // 409: the copies no longer match the plan (PLAN_CHANGED: make them
            // again), or the session moved on. Either way the dialog is out of
            // date: say so in the clerk's language, close it, re-read the session.
            if (apiErrorStatus(e) === 409) {
                toast.error(t(isPlanChanged(e) ? 'start.planChanged' : 'errors.locked'));
                onOpenChange(false);
                void queryClient.invalidateQueries({
                    queryKey: scanSessionKey(session.id, instituteId),
                });
                return;
            }
            toast.error(apiErrorMessage(e, t('start.failed')));
        },
    });

    return (
        <MyDialog
            heading={t('start.title')}
            open={open}
            onOpenChange={(next) => {
                if (start.isPending) return;
                onOpenChange(next);
            }}
            dialogWidth="max-w-3xl"
        >
            <div className="flex flex-col gap-4 p-4 sm:p-6">
                <p className="text-body text-neutral-600">
                    {t('start.intro', { count: copies, pages })}
                </p>

                <div
                    className={cn(
                        'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-body',
                        cost.sufficient === false
                            ? 'border-danger-200 bg-danger-50 text-danger-700'
                            : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                    )}
                >
                    <span className="flex items-center gap-2">
                        <Coins size={16} className="text-primary-500" />
                        {cost.credits == null
                            ? t('start.counting')
                            : t('start.cost', { count: copies, pages, credits: cost.credits })}
                    </span>
                    {cost.currentBalance != null && (
                        <span className="text-caption text-neutral-500">
                            {t('start.balance', { count: cost.currentBalance })}
                        </span>
                    )}
                </div>
                {cost.sufficient === false && (
                    <p className="flex items-start gap-2 text-caption text-danger-600">
                        <WarningCircle size={16} className="mt-px shrink-0" />
                        {t('start.insufficient')}
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

                <label className="flex items-center gap-2 text-body text-neutral-700">
                    <input
                        type="checkbox"
                        checked={notifyEmail}
                        onChange={(e) => setNotifyEmail(e.target.checked)}
                        className="size-4 accent-primary-500"
                    />
                    {t('start.notifyEmail')}
                </label>

                <div className="flex justify-end gap-2 border-t border-neutral-200 pt-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={start.isPending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('start.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={copies === 0 || start.isPending || cost.sufficient === false}
                        onClick={() => start.mutate()}
                    >
                        {start.isPending
                            ? t('start.starting')
                            : t('start.confirm', { count: copies })}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
};

export default StartCheckingDialog;
