import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
    ArrowCounterClockwise,
    CheckCircle,
    Gear,
    Info,
    Money,
    Prohibit,
    Warning,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatMonthValue } from '@/components/design-system/month-picker';
import type { PayrollRunDTO } from '@/routes/erp/-shared/hr-types';
import type { RunTransitions } from '@/routes/erp/-shared/payroll-status';

type ActionKey = 'process' | 'approve' | 'reject' | 'markPaid' | 'cancel';

interface RunActionBarProps {
    run: PayrollRunDTO;
    transitions: RunTransitions;
    isHrAdmin: boolean;
    onProcess: () => Promise<string | null>;
    onApprove: () => Promise<string | null>;
    onReject: () => Promise<string | null>;
    onMarkPaid: () => Promise<string | null>;
    onCancel: () => Promise<string | null>;
}

/**
 * The only place a payroll run can be moved forward or back.
 *
 * Which buttons exist is decided entirely by `runTransitions(run.status)` — the same
 * predicates the backend enforces — so a user is never offered an action that ends
 * in a 400. Nothing here is disabled-but-visible: an action that cannot happen
 * simply isn't rendered, because a greyed "Approve" on a Draft run invites the
 * question "why not" and has no answer worth reading.
 *
 * Every action is confirmed first. These transitions move real money and several are
 * expensive to undo, so the confirmation copy states the side effects the API has
 * rather than asking "are you sure?".
 */
export const RunActionBar = ({
    run,
    transitions,
    isHrAdmin,
    onProcess,
    onApprove,
    onReject,
    onMarkPaid,
    onCancel,
}: RunActionBarProps) => {
    const { t } = useTranslation('erpRunActionBar');
    const [pending, setPending] = useState<ActionKey | null>(null);

    const period =
        run.month && run.year
            ? formatMonthValue({ month: run.month, year: run.year })
            : t('thisMonth');

    /** Run an action, surface the server's own sentence, and close the confirmation. */
    const commit = async (action: () => Promise<string | null>) => {
        const message = await action();
        if (message === null) return; // already reported by the hook
        // Process returns "… N failed — see run errors" on a partial success, so the
        // server's wording is shown verbatim rather than a generic "Done".
        toast.success(message);
        setPending(null);
    };

    const anyAction =
        transitions.canProcess ||
        transitions.canApprove ||
        transitions.canReject ||
        transitions.canMarkPaid ||
        transitions.canCancel;

    if (!anyAction) return null;

    if (!isHrAdmin) {
        return (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-3">
                <Info size={18} className="mt-1 shrink-0 text-neutral-400" />
                <p className="text-caption text-muted-foreground">{t('adminOnlyNotice')}</p>
            </div>
        );
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-3">
                {transitions.canProcess && (
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setPending('process')}
                    >
                        <Gear size={16} />
                        {t('buttons.processRun')}
                    </MyButton>
                )}
                {transitions.canApprove && (
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setPending('approve')}
                    >
                        <CheckCircle size={16} />
                        {t('buttons.approveRun')}
                    </MyButton>
                )}
                {transitions.canMarkPaid && (
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setPending('markPaid')}
                    >
                        <Money size={16} />
                        {t('buttons.markAsPaid')}
                    </MyButton>
                )}
                {transitions.canReject && (
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => setPending('reject')}
                    >
                        <ArrowCounterClockwise size={16} />
                        {t('buttons.rejectAndRecalculate')}
                    </MyButton>
                )}
                {transitions.canCancel && (
                    <MyButton buttonType="text" scale="medium" onClick={() => setPending('cancel')}>
                        <Prohibit size={16} />
                        {t('buttons.cancelRun')}
                    </MyButton>
                )}
            </div>

            {/* ── Process ── */}
            <MyDialog
                heading={t('process.heading', { period })}
                open={pending === 'process'}
                onOpenChange={(open) => !open && setPending(null)}
                dialogWidth="max-w-lg"
                footer={
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setPending(null)}
                        >
                            {t('notYet')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={() => commit(onProcess)}
                            loadingText={t('process.processing')}
                        >
                            {t('buttons.processRun')}
                        </MyButton>
                    </>
                }
            >
                <div className="flex flex-col gap-3 text-body text-neutral-600">
                    <p>{t('process.body1')}</p>
                    <p>
                        {t('process.body2Prefix')}{' '}
                        <span className="font-semibold">
                            {t('process.body2Bold', { period })}
                        </span>
                        {t('process.body2Suffix')}
                    </p>
                    <p className="text-caption text-neutral-500">{t('process.body3')}</p>
                </div>
            </MyDialog>

            {/* ── Approve ── */}
            <MyDialog
                heading={t('approve.heading', { period })}
                open={pending === 'approve'}
                onOpenChange={(open) => !open && setPending(null)}
                dialogWidth="max-w-lg"
                footer={
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setPending(null)}
                        >
                            {t('approve.keepReviewing')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={() => commit(onApprove)}
                            loadingText={t('approve.approving')}
                        >
                            {t('buttons.approveRun')}
                        </MyButton>
                    </>
                }
            >
                <div className="flex flex-col gap-3 text-body text-neutral-600">
                    <p>
                        {t('approve.body1Prefix')}{' '}
                        <span className="font-semibold">{t('approve.body1Bold')}</span>{' '}
                        {t('approve.body1Suffix')}
                    </p>
                    <p>{t('approve.body2')}</p>
                </div>
            </MyDialog>

            {/* ── Mark paid ── */}
            <MyDialog
                heading={t('markPaid.heading', { period })}
                open={pending === 'markPaid'}
                onOpenChange={(open) => !open && setPending(null)}
                dialogWidth="max-w-lg"
                footer={
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setPending(null)}
                        >
                            {t('notYet')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={() => commit(onMarkPaid)}
                            loadingText={t('markPaid.marking')}
                        >
                            {t('buttons.markAsPaid')}
                        </MyButton>
                    </>
                }
            >
                <div className="flex flex-col gap-3 text-body text-neutral-600">
                    <p>{t('markPaid.body1')}</p>
                    <p className="text-caption text-neutral-500">{t('markPaid.body2')}</p>
                </div>
            </MyDialog>

            {/* ── Reject (destructive) ── */}
            <AlertDialog
                open={pending === 'reject'}
                onOpenChange={(open) => !open && setPending(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-danger-600">
                            <Warning size={20} weight="fill" />
                            {t('reject.title', { period })}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="flex flex-col gap-3 text-body text-neutral-600">
                                <p>{t('reject.intro')}</p>
                                <ul className="list-inside list-disc space-y-1 text-caption">
                                    <li>{t('reject.item1')}</li>
                                    <li>{t('reject.item2')}</li>
                                    <li>{t('reject.item3')}</li>
                                    <li>{t('reject.item4')}</li>
                                </ul>
                                <p>
                                    {t('reject.returnsPrefix')}{' '}
                                    <span className="font-semibold">{t('reject.draft')}</span>{' '}
                                    {t('reject.returnsSuffix')}
                                </p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('keepTheRun')}</AlertDialogCancel>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={() => commit(onReject)}
                            loadingText={t('reject.rejecting')}
                        >
                            {t('reject.confirm')}
                        </MyButton>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* ── Cancel (destructive) ── */}
            <AlertDialog
                open={pending === 'cancel'}
                onOpenChange={(open) => !open && setPending(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-danger-600">
                            <Warning size={20} weight="fill" />
                            {t('cancel.title', { period })}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="flex flex-col gap-3 text-body text-neutral-600">
                                <p>{t('cancel.body1')}</p>
                                <p>{t('cancel.body2', { period })}</p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('keepTheRun')}</AlertDialogCancel>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={() => commit(onCancel)}
                            loadingText={t('cancel.cancelling')}
                        >
                            {t('cancel.confirm')}
                        </MyButton>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
