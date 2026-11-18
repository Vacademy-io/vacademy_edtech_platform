import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowCounterClockwise, KeyReturn, Lock } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { getMarkingSummary, parseApiError, saveQuickMarks } from '@/services/submission-review/api';
import { invalidateAttempt } from '@/services/submission-review/query-keys';
import { markedByLabel } from '@/services/submission-review/labels';
import {
    allRows,
    buildQuickMarksItems,
    canMarkRestNotAnswered,
    clampMark,
    emptyRestCount,
    formatMark,
    formatMarkOutOf,
    initialQuickDrafts,
    isQuickEditable,
    markRestNotAnswered,
    nextNeedsMarking,
    notifyByDefault,
    quickTotal,
    releaseTokenOf,
    staleKeysOf,
    type QuickDrafts,
} from '@/services/submission-review/marks';
import { useSubmissionNavStore } from '@/services/submission-review/nav-store';
import type { QuestionRow, SubmissionOutline } from '@/services/submission-review/types';
import { useTypeLabel } from './MarkedByLabel';
import { StateBadge } from './StateBadge';

type SaveIntent = 'save' | 'next';

/**
 * The next learner who still needs marking, from the list the page was opened from (or the
 * test's "needs marking" list), checked against fresh counts (A10).
 */
export const findNextNeedsMarking = async (outline: SubmissionOutline): Promise<string | null> => {
    const nav = useSubmissionNavStore.getState();
    const current = outline.attempt_id;
    const fromList = nav.attemptIds.includes(current) ? nav.attemptIds : [];
    const walk = async (ids: string[], assumeUnknown: boolean): Promise<string | null> => {
        const others = ids.filter((id) => id !== current).slice(0, 100);
        if (others.length === 0) return null;
        const fresh = await getMarkingSummary(outline.assessment_id, others);
        return nextNeedsMarking(ids, current, fresh.attempts ?? {}, assumeUnknown && !fresh.attempts);
    };
    // The list the page was opened from first (one table page, or the strip's list) ...
    if (fromList.length > 0) {
        const next = await walk(fromList, nav.source === 'needs_marking');
        if (next || nav.source === 'needs_marking') return next;
    }
    // ... then the whole test: a table page holds only its own rows, and "nobody else needs
    // marking" must be true for the test, not for that page.
    const all = await getMarkingSummary(outline.assessment_id);
    const ids = [current, ...all.summary.needs_marking_attempt_ids.filter((id) => id !== current)];
    if (ids.length > 1) nav.set(outline.assessment_id, ids, 'needs_marking');
    return walk(ids, true);
};

/**
 * W2b Quick marks: one box per question in paper order, objective answers locked (labelled with
 * who set the mark; Edit marks changes them), a running
 * total, "Mark the rest as not answered", and one batch save (A3b). After release, Save
 * asks once for a reason and whether to send the learner the update.
 */
export const QuickMarksPanel = ({
    outline,
    onFocusRow,
    onNextAttempt,
}: {
    outline: SubmissionOutline;
    onFocusRow?: (row: QuestionRow) => void;
    onNextAttempt: (attemptId: string) => void;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const typeLabel = useTypeLabel();
    const queryClient = useQueryClient();
    const rows = useMemo(() => allRows(outline.sections), [outline.sections]);
    const [initial, setInitial] = useState<QuickDrafts>(() => initialQuickDrafts(rows));
    const [drafts, setDrafts] = useState<QuickDrafts>(initial);
    const [askRelease, setAskRelease] = useState<SaveIntent | null>(null);
    const [reason, setReason] = useState('');
    const [notify, setNotify] = useState(true);
    const pendingReset = useRef(false);
    const inputs = useRef<Record<string, HTMLInputElement | null>>({});

    // A new learner: fresh boxes. After a save: fresh boxes once the outline reloads.
    const attemptRef = useRef(outline.attempt_id);
    useEffect(() => {
        if (attemptRef.current !== outline.attempt_id || pendingReset.current) {
            attemptRef.current = outline.attempt_id;
            pendingReset.current = false;
            const next = initialQuickDrafts(rows);
            setInitial(next);
            setDrafts(next);
        }
    }, [outline.attempt_id, rows]);

    const released = outline.release.status === 'RELEASED';
    const items = useMemo(() => buildQuickMarksItems(drafts, initial, rows), [drafts, initial, rows]);
    const total = quickTotal(drafts, rows);
    const restOffered = canMarkRestNotAnswered(outline.kind, {
        evaluationType: outline.evaluation_type,
        responseFileId: outline.response_file_id,
    });
    const emptyNeeds = emptyRestCount(drafts, rows);
    const editableKeys = rows.filter(isQuickEditable).map((r) => r.key);

    const goNext = async () => {
        try {
            const next = await findNextNeedsMarking(outline);
            if (next) onNextAttempt(next);
            else toast.success(t('quick.allMarked'));
        } catch {
            toast.error(t('quick.nextFailed'));
        }
    };

    const save = useMutation({
        mutationFn: (args: { intent: SaveIntent; reason: string | null; notify: boolean }) =>
            saveQuickMarks(outline.attempt_id, {
                items,
                reason: args.reason,
                notify_learner: released ? args.notify : false,
                expected_release: releaseTokenOf(outline.release),
            }),
        onSuccess: (res, args) => {
            toast.success(
                res.update_queued
                    ? t('quick.savedAndSent', { count: res.changed, name: outline.learner.name })
                    : t('quick.saved', { count: res.changed })
            );
            pendingReset.current = true;
            setAskRelease(null);
            invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
            if (args.intent === 'next') void goNext();
        },
        onError: (error) => {
            const body = parseApiError(error);
            setAskRelease(null);
            if (body?.code === 'STALE_REVISION') {
                toast.error(t('quick.stale', { count: Math.max(1, staleKeysOf(body.details).length) }));
                invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
                return;
            }
            if (body?.code === 'RELEASE_CHANGED') {
                toast.error(t('quick.releaseChanged', { name: outline.learner.name }));
                invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
                return;
            }
            const key = typeof body?.details?.key === 'string' ? body.details.key : null;
            const row = key ? rows.find((r) => r.key === key) : null;
            toast.error(
                row
                    ? t('quick.rowError', { number: row.question_number, message: body?.message ?? '' })
                    : body?.message || t('quick.failed')
            );
        },
    });

    const submit = (intent: SaveIntent) => {
        if (items.length === 0) {
            if (intent === 'next') void goNext();
            else toast.info(t('quick.nothing'));
            return;
        }
        if (released) {
            setReason('');
            // One message per correction round: ticked only when this save leaves nothing to mark.
            setNotify(notifyByDefault(rows, items.map((i) => `${i.section_id}:${i.question_id}`)));
            setAskRelease(intent);
            return;
        }
        save.mutate({ intent, reason: null, notify: false });
    };

    const setDraft = (key: string, patch: Partial<QuickDrafts[string]>) =>
        setDrafts((d) => ({ ...d, [key]: { ...d[key]!, ...patch } }));

    // An objective row is not typed here (Edit marks changes it), but it says who set its
    // mark: the answer key, or the teacher who changed it (MANUAL), never "Answer key" for both.
    const lockedSourceLabel = (row: QuestionRow): string | null => {
        const by = markedByLabel(row.marked_by_kind, row.marked_by?.name, t('common.aTeacher'));
        if (!by) return null;
        return by.key === 'markedBy.answerKey'
            ? t(by.key, by.params)
            : t('markedBy.prefix', { who: t(by.key, by.params) });
    };

    const focusNext = (key: string) => {
        const i = editableKeys.indexOf(key);
        const nextKey = editableKeys[i + 1];
        if (nextKey) inputs.current[nextKey]?.focus();
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3 sm:p-4" data-testid="quick-marks">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-subtitle font-semibold text-neutral-800">
                    {t('quick.title', { name: outline.learner.name })}
                </h2>
                <span className="text-body font-semibold tabular-nums text-neutral-800" data-testid="quick-total">
                    {t('quick.total', { score: formatMarkOutOf(total, outline.max_total) })}
                </span>
            </div>
            <ol className="flex flex-col divide-y divide-neutral-100">
                {rows.map((row) => {
                    const d = drafts[row.key];
                    return (
                        <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                            <span className="w-10 shrink-0 font-semibold text-neutral-800">
                                {t('row.number', { number: row.question_number })}
                            </span>
                            <span className="w-32 min-w-0 shrink-0 truncate text-caption text-neutral-500 sm:w-40">
                                {typeLabel(row.question_type)}
                            </span>
                            {!d ? (
                                <span
                                    className="flex items-center gap-2 text-body text-neutral-600"
                                    title={t('quick.lockedHint')}
                                >
                                    <Lock size={14} className="text-neutral-400" aria-label={t('quick.lockedHint')} />
                                    <span className="tabular-nums">{formatMarkOutOf(row.marks, row.max_marks)}</span>
                                    {lockedSourceLabel(row) && (
                                        <span className="text-caption text-neutral-500" data-testid="quick-locked-source">
                                            {lockedSourceLabel(row)}
                                        </span>
                                    )}
                                </span>
                            ) : d.notAnswered ? (
                                <span className="flex items-center gap-2">
                                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-caption font-medium text-neutral-600">
                                        {t('state.notAnswered')} · {formatMarkOutOf(0, row.max_marks)}
                                    </span>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        className="gap-1"
                                        onClick={() => {
                                            setDraft(row.key, { notAnswered: false });
                                            setTimeout(() => inputs.current[row.key]?.focus(), 0);
                                        }}
                                    >
                                        <ArrowCounterClockwise size={12} />
                                        {t('quick.undoNotAnswered')}
                                    </MyButton>
                                </span>
                            ) : (
                                <span className="flex flex-wrap items-center gap-2">
                                    <span className="flex items-center gap-1.5">
                                        <Input
                                            ref={(el) => {
                                                inputs.current[row.key] = el;
                                            }}
                                            type="number"
                                            inputMode="decimal"
                                            step="0.5"
                                            min={row.min_marks}
                                            max={row.max_marks ?? undefined}
                                            value={d.value}
                                            aria-label={t('quick.marksFor', { number: row.question_number })}
                                            onFocus={() => onFocusRow?.(row)}
                                            onChange={(e) => setDraft(row.key, { value: e.target.value })}
                                            onBlur={() => {
                                                if (d.value.trim() === '') return;
                                                const n = Number(d.value.replace(',', '.'));
                                                setDraft(row.key, {
                                                    value: formatMark(clampMark(n, row.min_marks, row.max_marks)),
                                                });
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    focusNext(row.key);
                                                }
                                            }}
                                            className="h-8 w-20 tabular-nums"
                                        />
                                        <span className="text-body text-neutral-500">/ {formatMark(row.max_marks)}</span>
                                    </span>
                                    <Input
                                        value={d.feedback}
                                        placeholder={t('quick.feedbackPlaceholder')}
                                        aria-label={t('quick.feedbackFor', { number: row.question_number })}
                                        onFocus={() => onFocusRow?.(row)}
                                        onChange={(e) => setDraft(row.key, { feedback: e.target.value })}
                                        className="h-8 w-full min-w-40 flex-1 sm:w-56"
                                    />
                                </span>
                            )}
                            <StateBadge row={row} hideMarked className={cn('ms-auto', !d && 'hidden sm:inline-flex')} />
                        </li>
                    );
                })}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3">
                {restOffered ? (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        className="sm:min-w-0"
                        disabled={emptyNeeds === 0}
                        onClick={() => setDrafts((dr) => markRestNotAnswered(dr, rows))}
                    >
                        {t('actions.markRestNotAnswered', { count: emptyNeeds })}
                    </MyButton>
                ) : (
                    <span />
                )}
                <div className="flex flex-wrap gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        className="sm:min-w-0"
                        disabled={save.isPending}
                        onClick={() => submit('save')}
                    >
                        {save.isPending ? t('quick.saving') : t('actions.save')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        className="gap-1.5 sm:min-w-0"
                        disabled={save.isPending}
                        onClick={() => submit('next')}
                    >
                        {t('actions.saveNext')}
                        <KeyReturn size={16} />
                    </MyButton>
                </div>
            </div>

            <Dialog open={askRelease !== null} onOpenChange={(o) => !o && setAskRelease(null)}>
                <DialogContent className="flex w-dialog-md flex-col gap-0 p-0">
                    <DialogTitle asChild>
                        <h2 className="rounded-t-lg bg-primary-50 p-4 text-subtitle font-semibold text-primary-500">
                            {t('quick.releasedTitle')}
                        </h2>
                    </DialogTitle>
                    <div className="flex flex-col gap-3 p-4">
                        <p className="text-body text-neutral-700">
                            {t('edit.releasedNote', { name: outline.learner.name })}
                        </p>
                        <label className="flex flex-col gap-1 text-body font-medium text-neutral-700">
                            {t('edit.reason')}
                            <Input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder={t('edit.reasonPlaceholder')}
                                className="h-9"
                                autoFocus
                            />
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-body text-neutral-700">
                            <Checkbox
                                checked={notify}
                                onCheckedChange={(v) => setNotify(v === true)}
                                aria-label={t('edit.notify', { name: outline.learner.name })}
                            />
                            {t('edit.notify', { name: outline.learner.name })}
                        </label>
                        <div className="flex justify-end gap-2">
                            <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => setAskRelease(null)}>
                                {t('common.cancel')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                disabled={!reason.trim() || save.isPending}
                                onClick={() =>
                                    askRelease && save.mutate({ intent: askRelease, reason: reason.trim(), notify })
                                }
                            >
                                {t('quick.saveCount', { count: items.length })}
                            </MyButton>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
