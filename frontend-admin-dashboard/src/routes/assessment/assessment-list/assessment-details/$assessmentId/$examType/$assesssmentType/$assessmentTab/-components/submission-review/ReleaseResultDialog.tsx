import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowCounterClockwise,
    CheckCircle,
    Circle,
    CircleHalf,
    Hourglass,
    PaperPlaneTilt,
} from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getInstituteId } from '@/constants/helper';
import { getReleaseCheck, releaseResultW9, type ReleaseW9Options } from '@/services/submission-review/api';
import { submissionKeys } from '@/services/submission-review/query-keys';
import type { ReleaseCheck } from '@/services/submission-review/types';
import { reseedVisibleMarkings, useOpenSubmission } from './use-attempt-marking';

export type ReleaseChoice = 'ready' | 'all';

/** What W9 sends for the chosen options (contract §9.4). Pure, tested. */
export const w9RequestFlags = (
    choice: ReleaseChoice,
    autoRest: boolean,
    sendAgain: boolean,
    waitingCount: number
): ReleaseW9Options => ({
    skip_unready: choice === 'ready',
    skip_already_released: !sendAgain,
    allow_unmarked: choice === 'all',
    release_when_marked: choice === 'ready' && autoRest && waitingCount > 0,
});

/** n = ready now (ready + AI drafts, + already released when re-sending); m = waiting. */
export const w9Counts = (check: ReleaseCheck, sendAgain: boolean) => {
    const readyNow = check.ready.count + check.ai_drafts.count + (sendAgain ? check.already_released.count : 0);
    const waiting = check.unmarked.count + check.ai_checking.count;
    const all = check.selected - (sendAgain ? 0 : check.already_released.count);
    return { readyNow, waiting, all: Math.max(0, all) };
};

/**
 * W9: release a whole test (or the selected learners) with a warning about answers that
 * are not marked yet. Default: release the ready ones now and the rest automatically once
 * marked. "Release all" needs an explicit "I understand".
 */
export const ReleaseResultDialog = ({
    assessmentId,
    attemptIds,
    open,
    onOpenChange,
    onReleased,
}: {
    assessmentId: string;
    attemptIds: string[] | 'ALL';
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onReleased?: () => void;
}) => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    const queryClient = useQueryClient();
    const openSubmission = useOpenSubmission();
    const instituteId = getInstituteId();
    const idsKey = attemptIds === 'ALL' ? 'ALL' : [...attemptIds].sort().join(',');

    const [choice, setChoice] = useState<ReleaseChoice>('ready');
    const [autoRest, setAutoRest] = useState(true);
    const [sendAgain, setSendAgain] = useState(false);
    const [understood, setUnderstood] = useState(false);

    useEffect(() => {
        if (!open) return;
        setChoice('ready');
        setAutoRest(true);
        setSendAgain(false);
        setUnderstood(false);
    }, [open]);

    const checkQuery = useQuery({
        queryKey: submissionKeys.releaseCheck(assessmentId, idsKey),
        queryFn: () => getReleaseCheck(assessmentId, attemptIds),
        enabled: open && !!assessmentId && (attemptIds === 'ALL' || attemptIds.length > 0),
        staleTime: 0,
        gcTime: 0,
    });
    const check = checkQuery.data;
    const counts = useMemo(() => (check ? w9Counts(check, sendAgain) : null), [check, sendAgain]);

    const release = useMutation({
        mutationFn: () =>
            releaseResultW9(
                assessmentId,
                instituteId,
                attemptIds,
                w9RequestFlags(choice, autoRest, sendAgain, counts?.waiting ?? 0)
            ),
        onSuccess: () => {
            toast.success(
                t('w9.releasing', { count: choice === 'ready' ? counts?.readyNow ?? 0 : counts?.all ?? 0 })
            );
            queryClient.invalidateQueries({ queryKey: ['SUBMISSION_MARKING_SUMMARY', assessmentId] });
            // One batched call for the rows on screen (not one refetch per row).
            void reseedVisibleMarkings(queryClient, assessmentId);
            queryClient.invalidateQueries({ queryKey: ['SUBMISSION_REVIEW'] });
            queryClient.invalidateQueries({ queryKey: ['SUBMISSION_RELEASE_CHECK', assessmentId] });
            onReleased?.();
            onOpenChange(false);
        },
        onError: () => toast.error(t('w9.failed')),
    });

    const canRelease =
        !!check &&
        !!counts &&
        !release.isPending &&
        (choice === 'all'
            ? understood && counts.all > 0
            : counts.readyNow > 0 || (autoRest && counts.waiting > 0));

    const seeUnmarked = () => {
        const ids = check?.unmarked.attempt_ids ?? [];
        if (ids.length === 0) return;
        onOpenChange(false);
        openSubmission(ids[0]!, {
            assessmentId,
            attemptIds: ids,
            source: 'needs_marking',
            search: { filter: 'needs_marking' },
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-dialog-tall w-dialog-md flex-col gap-0 overflow-y-auto p-0">
                <DialogTitle asChild>
                    <h2 className="rounded-t-lg bg-primary-50 p-4 text-subtitle font-semibold text-primary-500">
                        {t('w9.title')}
                    </h2>
                </DialogTitle>
                {checkQuery.isLoading || !check || !counts ? (
                    <div className="p-6">
                        {checkQuery.isError ? (
                            <p className="text-body text-danger-600">{t('w9.loadFailed')}</p>
                        ) : (
                            <DashboardLoader />
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 p-4">
                        <p className="text-body font-semibold text-neutral-800" data-testid="w9-selected">
                            {t('w9.selected', { count: check.selected })}
                        </p>
                        <ul className="flex flex-col gap-2 text-body text-neutral-700">
                            <li className="flex items-center gap-2">
                                <CheckCircle size={16} weight="fill" className="shrink-0 text-success-600" />
                                {t('w9.ready', { count: check.ready.count })}
                            </li>
                            {check.unmarked.count > 0 && (
                                <li className="flex flex-wrap items-center gap-2">
                                    <Circle size={14} weight="fill" className="shrink-0 text-warning-600" />
                                    {t('w9.unmarked', {
                                        count: check.unmarked.count,
                                        answers: check.unmarked.answers,
                                    })}
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        className="h-auto !p-0 underline"
                                        onClick={seeUnmarked}
                                    >
                                        {t('w9.seeThem')}
                                    </MyButton>
                                </li>
                            )}
                            {check.ai_checking.count > 0 && (
                                <li className="flex items-center gap-2">
                                    <Hourglass size={16} className="shrink-0 text-info-600" />
                                    {check.ai_checking.eta_minutes != null
                                        ? t('w9.aiCheckingEta', {
                                              count: check.ai_checking.count,
                                              minutes: check.ai_checking.eta_minutes,
                                          })
                                        : t('w9.aiChecking', { count: check.ai_checking.count })}
                                </li>
                            )}
                            {check.ai_drafts.count > 0 && (
                                <li className="flex items-center gap-2">
                                    <CircleHalf size={16} weight="fill" className="shrink-0 text-primary-500" />
                                    {t('w9.aiDrafts', { count: check.ai_drafts.count })}
                                </li>
                            )}
                            {check.not_submitted.count > 0 && (
                                <li className="flex items-center gap-2">
                                    <Circle size={14} className="shrink-0 text-neutral-400" />
                                    {t('w9.notSubmitted', { count: check.not_submitted.count })}
                                </li>
                            )}
                            {check.already_released.count > 0 && (
                                <li className="flex flex-wrap items-center gap-2">
                                    <ArrowCounterClockwise size={16} className="shrink-0 text-neutral-500" />
                                    {t('w9.alreadyReleased', { count: check.already_released.count })}
                                    <label className="inline-flex cursor-pointer items-center gap-2 text-neutral-600">
                                        <Checkbox
                                            checked={sendAgain}
                                            onCheckedChange={(v) => setSendAgain(v === true)}
                                            aria-label={t('w9.sendAgain')}
                                        />
                                        {t('w9.sendAgain')}
                                    </label>
                                </li>
                            )}
                        </ul>
                        <p className="rounded-md bg-neutral-50 p-3 text-caption text-neutral-600">
                            {check.notifications.learner_result_notifications
                                ? t('w9.notifyOn')
                                : t('w9.notifyOff')}
                        </p>

                        <RadioGroup
                            value={choice}
                            onValueChange={(v) => setChoice(v as ReleaseChoice)}
                            className="flex flex-col gap-3"
                        >
                            <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
                                <label className="flex cursor-pointer items-center gap-2 text-body font-medium text-neutral-800">
                                    <RadioGroupItem value="ready" aria-label={t('w9.releaseReady', { count: counts.readyNow })} />
                                    {t('w9.releaseReady', { count: counts.readyNow })}
                                </label>
                                {counts.waiting > 0 && (
                                    <label className="ms-7 flex cursor-pointer items-start gap-2 text-caption text-neutral-600">
                                        <Checkbox
                                            checked={autoRest}
                                            disabled={choice !== 'ready'}
                                            onCheckedChange={(v) => setAutoRest(v === true)}
                                            aria-label={t('w9.autoRest', { count: counts.waiting })}
                                        />
                                        {t('w9.autoRest', { count: counts.waiting })}
                                    </label>
                                )}
                            </div>
                            <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
                                <label className="flex cursor-pointer items-center gap-2 text-body font-medium text-neutral-800">
                                    <RadioGroupItem value="all" aria-label={t('w9.releaseAll', { count: counts.all })} />
                                    {t('w9.releaseAll', { count: counts.all })}
                                </label>
                                {choice === 'all' && (
                                    <label className="ms-7 flex cursor-pointer items-center gap-2 text-caption text-danger-600">
                                        <Checkbox
                                            checked={understood}
                                            onCheckedChange={(v) => setUnderstood(v === true)}
                                            aria-label={t('w9.understand')}
                                        />
                                        {t('w9.understand')}
                                    </label>
                                )}
                            </div>
                        </RadioGroup>

                        <div className="flex justify-end gap-2">
                            <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                                {t('common.cancel')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className="gap-1.5"
                                disabled={!canRelease}
                                onClick={() => release.mutate()}
                            >
                                <PaperPlaneTilt size={16} weight="fill" />
                                {release.isPending ? t('w9.releasingButton') : t('w9.release')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
