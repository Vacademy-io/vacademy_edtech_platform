import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Circle, Hourglass, Info, PaperPlaneTilt, WarningCircle } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { MyButton } from '@/components/design-system/button';
import { httpStatusOf, parseApiError, releaseSubmission } from '@/services/submission-review/api';
import { invalidateAttempt } from '@/services/submission-review/query-keys';
import type { ReleaseBlocker } from '@/services/submission-review/types';
import { useOpenSubmission } from './use-attempt-marking';

type Step = { kind: 'confirm' } | { kind: 'blockers'; blockers: ReleaseBlocker[]; etaMinutes: number | null };

const blockersOf = (details: Record<string, unknown> | undefined): ReleaseBlocker[] =>
    Array.isArray(details?.blockers) ? (details!.blockers as ReleaseBlocker[]) : [];

/**
 * Release one learner's result (row menu and Submission page, contract §9.6). When answers
 * are not marked yet the server answers 409 BLOCKERS and the dialog lists them, with
 * Mark them now · Release when marking is done · Release anyway (after "I understand").
 */
export const ReleaseSubmissionDialog = ({
    attemptId,
    assessmentId,
    learnerName,
    releaseToken,
    aiDrafts = 0,
    open,
    onOpenChange,
    onDone,
    onMarkNow,
}: {
    attemptId: string;
    assessmentId?: string;
    learnerName: string;
    /** A1 / A10 release token; omitted = no stale-release check. */
    releaseToken?: string | null;
    /** AI marks nobody checked yet: releasing counts as the teacher's OK (owner decision 1). */
    aiDrafts?: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone?: () => void;
    /** Overrides "Mark them now" (the Submission page filters itself instead of navigating). */
    onMarkNow?: () => void;
}) => {
    const { t } = useTranslation(['assessmentSubmissionReviewList', 'assessmentSubmissionReview']);
    const queryClient = useQueryClient();
    const openSubmission = useOpenSubmission();
    const [step, setStep] = useState<Step>({ kind: 'confirm' });
    const [understood, setUnderstood] = useState(false);

    useEffect(() => {
        if (open) {
            setStep({ kind: 'confirm' });
            setUnderstood(false);
        }
    }, [open]);

    const refresh = () => invalidateAttempt(queryClient, attemptId, assessmentId);

    const release = useMutation({
        mutationFn: (opts: { allow_unmarked?: boolean; release_when_marked?: boolean }) =>
            releaseSubmission(attemptId, {
                notify: true,
                expected_release: releaseToken ?? null,
                ...opts,
            }),
        onSuccess: (res) => {
            if (!res.released && res.release_when_marked) {
                toast.success(t('row.releaseWhenMarkedDone', { name: learnerName }));
            } else {
                toast.success(t('row.released', { name: learnerName }));
            }
            refresh();
            onDone?.();
            onOpenChange(false);
        },
        onError: (error) => {
            const body = parseApiError(error);
            switch (body?.code) {
                case 'BLOCKERS':
                    setStep({
                        kind: 'blockers',
                        blockers: blockersOf(body.details),
                        etaMinutes: typeof body.details?.ai_eta_minutes === 'number' ? body.details.ai_eta_minutes : null,
                    });
                    return;
                case 'RELEASE_CHANGED':
                case 'ALREADY_RELEASED':
                    toast.info(t('row.alreadyChanged', { name: learnerName }));
                    refresh();
                    onOpenChange(false);
                    return;
                case 'API_EXAM':
                    toast.error(t('row.apiExam'));
                    return;
                case 'ATTEMPT_NOT_SUBMITTED':
                    toast.error(t('row.notSubmitted'));
                    return;
                default:
                    toast.error(httpStatusOf(error) === 403 ? t('row.forbidden') : body?.message || t('row.releaseFailed'));
            }
        },
    });

    const markNow = () => {
        onOpenChange(false);
        if (onMarkNow) {
            onMarkNow();
            return;
        }
        openSubmission(attemptId, { search: { filter: 'needs_marking' } });
    };

    const blockerLine = (b: ReleaseBlocker, eta: number | null) => {
        const type = t(`assessmentSubmissionReview:type.${b.question_type}`, { defaultValue: b.question_type });
        const state =
            b.state === 'AI_CHECKING'
                ? eta != null
                    ? t('row.blockerAiCheckingEta', { minutes: eta })
                    : t('row.blockerAiChecking')
                : b.state === 'AI_FAILED'
                  ? t('row.blockerAiFailed', { reason: b.reason ?? '' })
                  : t('row.blockerNeedsMarking');
        return `${t('row.questionNumber', { number: b.question_number })} · ${type} · ${state}`;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-dialog-tall w-dialog-md flex-col gap-0 overflow-y-auto p-0">
                <DialogTitle asChild>
                    <h2 className="rounded-t-lg bg-primary-50 p-4 text-subtitle font-semibold text-primary-500">
                        {t('row.releaseTitle', { name: learnerName })}
                    </h2>
                </DialogTitle>
                {step.kind === 'confirm' ? (
                    <div className="flex flex-col gap-4 p-4">
                        <p className="text-body text-neutral-700">{t('row.releaseConfirm', { name: learnerName })}</p>
                        {aiDrafts > 0 && (
                            <p className="flex items-start gap-2 rounded-md border border-info-200 bg-info-50 p-3 text-body text-info-700">
                                <Info size={16} className="mt-0.5 shrink-0" />
                                {t('row.releaseAiDrafts', { count: aiDrafts })}
                            </p>
                        )}
                        <div className="flex justify-end gap-2">
                            <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                                {t('common.cancel')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className="gap-1.5"
                                disabled={release.isPending}
                                onClick={() => release.mutate({})}
                            >
                                <PaperPlaneTilt size={16} weight="fill" />
                                {release.isPending ? t('row.releasing') : t('row.release')}
                            </MyButton>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 p-4">
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-body text-warning-700">
                            <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" />
                            <p>{t('row.blockersIntro', { count: step.blockers.length })}</p>
                        </div>
                        <ul className="flex max-h-list-md flex-col gap-1.5 overflow-y-auto text-body text-neutral-700">
                            {step.blockers.map((b) => (
                                <li key={b.key} className="flex items-center gap-2">
                                    {b.state === 'AI_CHECKING' ? (
                                        <Hourglass size={14} className="shrink-0 text-info-600" />
                                    ) : (
                                        <Circle size={10} weight="fill" className="shrink-0 text-warning-600" />
                                    )}
                                    {blockerLine(b, step.etaMinutes)}
                                </li>
                            ))}
                        </ul>
                        <label className="flex cursor-pointer items-center gap-2 text-caption text-danger-600">
                            <Checkbox
                                checked={understood}
                                onCheckedChange={(v) => setUnderstood(v === true)}
                                aria-label={t('row.understand')}
                            />
                            {t('row.understand')}
                        </label>
                        <div className="flex flex-wrap justify-end gap-2">
                            <MyButton type="button" buttonType="secondary" scale="medium" onClick={markNow}>
                                {t('row.markNow')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                disabled={release.isPending}
                                onClick={() => release.mutate({ release_when_marked: true })}
                            >
                                {t('row.releaseWhenMarked')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                disabled={!understood || release.isPending}
                                onClick={() => release.mutate({ allow_unmarked: true })}
                            >
                                {t('row.releaseAnyway')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
