import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { httpStatusOf, parseApiError, sendUpdatedResult, withdrawResult } from '@/services/submission-review/api';
import { invalidateAttempt } from '@/services/submission-review/query-keys';

interface Props {
    attemptId: string;
    assessmentId?: string;
    learnerName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone?: () => void;
}

const ConfirmShell = ({
    title,
    message,
    confirm,
    busy,
    danger,
    onConfirm,
    onCancel,
    open,
    onOpenChange,
}: {
    title: string;
    message: string;
    confirm: string;
    busy: boolean;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex w-dialog-md flex-col gap-0 p-0">
                <DialogTitle asChild>
                    <h2 className="rounded-t-lg bg-primary-50 p-4 text-subtitle font-semibold text-primary-500">{title}</h2>
                </DialogTitle>
                <div className="flex flex-col gap-4 p-4">
                    <p className="text-body text-neutral-700">{message}</p>
                    <div className="flex justify-end gap-2">
                        <MyButton type="button" buttonType="secondary" scale="medium" onClick={onCancel}>
                            {t('common.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            className={danger ? 'bg-danger-600 hover:bg-danger-500' : undefined}
                            disabled={busy}
                            onClick={onConfirm}
                        >
                            {confirm}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const errorText = (t: (k: string) => string, error: unknown): string => {
    const body = parseApiError(error);
    if (body?.code === 'NOT_RELEASED') return t('row.notReleased');
    if (body?.code === 'API_EXAM') return t('row.apiExam');
    if (httpStatusOf(error) === 403) return t('row.forbidden');
    return body?.message || t('row.actionFailed');
};

/** A9b: "Send {{name}} the updated result by email?" (one email, contract §5.2). */
export const SendUpdateDialog = ({ attemptId, assessmentId, learnerName, open, onOpenChange, onDone }: Props) => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    const queryClient = useQueryClient();
    const send = useMutation({
        mutationFn: () => sendUpdatedResult(attemptId),
        onSuccess: () => {
            toast.success(t('row.updateSent', { name: learnerName }));
            invalidateAttempt(queryClient, attemptId, assessmentId);
            onDone?.();
            onOpenChange(false);
        },
        onError: (error) => toast.error(errorText(t, error)),
    });
    return (
        <ConfirmShell
            open={open}
            onOpenChange={onOpenChange}
            title={t('row.sendUpdateTitle')}
            message={t('row.sendUpdateConfirm', { name: learnerName })}
            confirm={send.isPending ? t('row.sending') : t('row.sendUpdate')}
            busy={send.isPending}
            onConfirm={() => send.mutate()}
            onCancel={() => onOpenChange(false)}
        />
    );
};

/** A9: "{{name}} will see 'Results pending' until you release again." */
export const HideResultDialog = ({ attemptId, assessmentId, learnerName, open, onOpenChange, onDone }: Props) => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    const queryClient = useQueryClient();
    const hide = useMutation({
        mutationFn: () => withdrawResult(attemptId, null),
        onSuccess: () => {
            toast.success(t('row.hidden', { name: learnerName }));
            invalidateAttempt(queryClient, attemptId, assessmentId);
            onDone?.();
            onOpenChange(false);
        },
        onError: (error) => toast.error(errorText(t, error)),
    });
    return (
        <ConfirmShell
            open={open}
            onOpenChange={onOpenChange}
            title={t('row.hideTitle')}
            message={t('row.hideConfirm', { name: learnerName })}
            confirm={hide.isPending ? t('row.hiding') : t('row.hide')}
            busy={hide.isPending}
            danger
            onConfirm={() => hide.mutate()}
            onCancel={() => onOpenChange(false)}
        />
    );
};
