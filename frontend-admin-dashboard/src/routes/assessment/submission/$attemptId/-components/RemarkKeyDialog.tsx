import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { WarningCircle } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { httpStatusOf, parseApiError, reapplyAnswerKey } from '@/services/submission-review/api';
import { invalidateAttempt } from '@/services/submission-review/query-keys';
import { formatMark, releaseTokenOf } from '@/services/submission-review/marks';
import type { QuestionRow, SubmissionOutline } from '@/services/submission-review/types';

/**
 * Re-mark one objective answer with the answer key (A6). A teacher's or AI mark is kept
 * (409 PROTECTED_MARK); an admin may then choose "Replace the teacher's mark".
 */
export const RemarkKeyDialog = ({
    outline,
    row,
    open,
    onOpenChange,
}: {
    outline: SubmissionOutline;
    row: QuestionRow;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const queryClient = useQueryClient();
    const [reason, setReason] = useState('');
    const [protectedSource, setProtectedSource] = useState<string | null>(null);
    useEffect(() => {
        if (open) {
            setReason('');
            setProtectedSource(null);
        }
    }, [open]);
    const released = outline.release.status === 'RELEASED';

    const remark = useMutation({
        mutationFn: (force: boolean) =>
            reapplyAnswerKey(outline.attempt_id, row.section_id, row.question_id, {
                force,
                reason: reason.trim() || null,
                expected_release: releaseTokenOf(outline.release),
            }),
        onSuccess: (res) => {
            toast.success(
                t('remark.done', { old: formatMark(row.marks), new: formatMark(res.row.marks), max: formatMark(res.row.max_marks) })
            );
            invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
            onOpenChange(false);
        },
        onError: (error) => {
            const body = parseApiError(error);
            if (body?.code === 'PROTECTED_MARK') {
                setProtectedSource(String(body.details?.marks_source ?? ''));
                return;
            }
            if (body?.code === 'RELEASE_CHANGED') {
                invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
                toast.error(t('remark.releaseChanged'));
                onOpenChange(false);
                return;
            }
            toast.error(httpStatusOf(error) === 403 ? t('remark.forbidden') : body?.message || t('remark.failed'));
        },
    });

    const needsReason = released && !reason.trim();
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex w-dialog-md flex-col gap-0 p-0">
                <DialogTitle asChild>
                    <h2 className="rounded-t-lg bg-primary-50 p-4 text-subtitle font-semibold text-primary-500">
                        {t('remark.title', { number: row.question_number })}
                    </h2>
                </DialogTitle>
                <div className="flex flex-col gap-4 p-4">
                    <p className="text-body text-neutral-700">
                        {t('remark.body', { marks: formatMark(row.marks), max: formatMark(row.max_marks) })}
                    </p>
                    {released && (
                        <label className="flex flex-col gap-1 text-body font-medium text-neutral-700">
                            {t('edit.reason')} <span className="text-caption font-normal text-neutral-500">{t('edit.reasonRequired')}</span>
                            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" />
                        </label>
                    )}
                    {protectedSource !== null && (
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-body text-warning-700">
                            <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
                            <p>
                                {outline.permissions.can_force_answer_key
                                    ? t('remark.protectedCanForce')
                                    : t('remark.protected')}
                            </p>
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                            {t('common.cancel')}
                        </MyButton>
                        {protectedSource !== null ? (
                            outline.permissions.can_force_answer_key && (
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    scale="medium"
                                    disabled={remark.isPending || needsReason}
                                    onClick={() => remark.mutate(true)}
                                >
                                    {t('remark.force')}
                                </MyButton>
                            )
                        ) : (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                disabled={remark.isPending || needsReason}
                                onClick={() => remark.mutate(false)}
                            >
                                {remark.isPending ? t('remark.working') : t('remark.confirm')}
                            </MyButton>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
