import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CaretDown, CaretRight, Info, WarningCircle } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { editMarks, getQuestionDetail, httpStatusOf, parseApiError } from '@/services/submission-review/api';
import { invalidateAttempt, submissionKeys } from '@/services/submission-review/query-keys';
import { allRows, formatMark, isObjectiveType, notifyByDefault } from '@/services/submission-review/marks';
import type {
    EditMarksRequest,
    EditMarksResponse,
    QuestionRow,
    ReleaseInfo,
    SubmissionOutline,
} from '@/services/submission-review/types';
import {
    PenNotesEditor,
    buildAnnotationEdits,
    editableNotes,
    initialNoteChoices,
    type NoteChoice,
    type StoredAnnotation,
} from '@/routes/assessment/evaluation-ai/$attemptId/$processId/-components/PenNotesEditor';
import type { AnnotationEdit } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';
import {
    buildEditRequest,
    editErrorView,
    partSum,
    validateEditForm,
    type EditErrorView,
    type EditForm,
    type FieldError,
} from '../-utils/edit-marks';
import { MarkedByLabel, useTypeLabel } from './MarkedByLabel';

export type EditMode = 'edit' | 'notAnswered';

/** Pen notes for one question from the AI run (handwritten copies). */
export interface PenNotesSource {
    annotations: StoredAnnotation[];
    saved: AnnotationEdit[] | null | undefined;
}

const toRequestEdits = (edits: AnnotationEdit[]): NonNullable<EditMarksRequest['annotation_edits']> =>
    edits.map((e) => ({
        style: e.style ?? '',
        target: e.target ?? '',
        page_id: e.page_id ?? '',
        text: e.text ?? '',
        action: e.action,
        ...(e.new_text ? { new_text: e.new_text } : {}),
    }));

/**
 * W4 Edit marks (contract §9.9): marks with the max, optional per-scheme-point marks,
 * feedback, reason (required after release), a live total preview, and — after release —
 * "Send {{name}} the updated result". 409s keep the dialog open with what happened.
 */
export const EditMarksDialog = ({
    outline,
    row,
    mode,
    open,
    onOpenChange,
    penNotes,
}: {
    outline: SubmissionOutline;
    row: QuestionRow;
    mode: EditMode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    penNotes?: PenNotesSource | null;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const typeLabel = useTypeLabel();
    const queryClient = useQueryClient();
    const learner = outline.learner.name;
    const { data: detail } = useQuery({
        queryKey: submissionKeys.card(outline.attempt_id, row.section_id, row.question_id),
        queryFn: () => getQuestionDetail(outline.attempt_id, row.section_id, row.question_id),
        enabled: open,
        staleTime: 30_000,
    });

    // The row and release the dialog is editing against; a 409 moves them forward.
    const [base, setBase] = useState<QuestionRow>(row);
    const [release, setRelease] = useState<ReleaseInfo>(outline.release);
    // "Send the updated result" starts ticked only when this edit leaves nothing else to mark:
    // one message per correction round (owner decision 4); otherwise "Send updated result" at the end.
    const notifyDefault = notifyByDefault(allRows(outline.sections), [row.key]);
    const [form, setForm] = useState<EditForm>(() => initialForm(row, null, notifyDefault));
    const [noteChoices, setNoteChoices] = useState<Record<number, NoteChoice>>({});
    const [notesOpen, setNotesOpen] = useState(false);
    const [conflict, setConflict] = useState<EditErrorView | null>(null);
    const [serverField, setServerField] = useState<FieldError | null>(null);
    const [preview, setPreview] = useState<EditMarksResponse | null>(null);
    const seeded = useRef(false);

    useEffect(() => {
        if (!open) {
            seeded.current = false;
            return;
        }
        setBase(row);
        setRelease(outline.release);
        setConflict(null);
        setServerField(null);
        setPreview(null);
        setForm(initialForm(row, null, notifyDefault));
        setNoteChoices(initialNoteChoices(penNotes?.annotations, penNotes?.saved));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, row.key]);

    // Feedback and part marks arrive with the card detail (A1d).
    useEffect(() => {
        if (!open || !detail || seeded.current) return;
        seeded.current = true;
        setForm((f) => ({ ...initialForm(base, detail, f.notify), marks: f.marks }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, detail]);

    const released = release.status === 'RELEASED';
    const notAnswered = mode === 'notAnswered';
    const errors = useMemo(
        () => (notAnswered ? (released && !form.reason.trim() ? [{ field: 'reason' as const, key: 'edit.errors.reasonRequired' }] : []) : validateEditForm(form, base, released)),
        [form, base, released, notAnswered]
    );
    const fieldError = (field: FieldError['field']) =>
        errors.find((e) => e.field === field) ?? (serverField?.field === field ? serverField : null);

    const annotations = penNotes?.annotations ?? [];
    const hasPenNotes = editableNotes(annotations).length > 0;
    const body = (opts: { preview?: boolean }): EditMarksRequest => ({
        ...buildEditRequest(form, base, release, detail?.evaluator_feedback ?? '', {
            preview: opts.preview,
            notAnswered,
        }),
        ...(hasPenNotes && !opts.preview
            ? { annotation_edits: toRequestEdits(buildAnnotationEdits(annotations, noteChoices)) }
            : {}),
    });

    // Live total preview (A3 preview=true), 400 ms after the last change.
    const marksErrors = errors.filter((e) => e.field !== 'reason');
    const previewKey = `${form.marks}|${form.useParts ? form.parts.map((p) => p.value).join(',') : ''}|${notAnswered}`;
    useEffect(() => {
        if (!open || marksErrors.length > 0) {
            setPreview(null);
            return;
        }
        const handle = window.setTimeout(() => {
            editMarks(outline.attempt_id, base.section_id, base.question_id, body({ preview: true }))
                .then(setPreview)
                .catch(() => setPreview(null));
        }, 400);
        return () => window.clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, previewKey, base.revision, release.token]);

    const save = useMutation({
        mutationFn: () => editMarks(outline.attempt_id, base.section_id, base.question_id, body({})),
        onSuccess: (res) => {
            toast.success(res.update_queued ? t('edit.savedAndSent', { name: learner }) : t('edit.saved'));
            invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
            onOpenChange(false);
        },
        onError: (error) => {
            const view = editErrorView(parseApiError(error), httpStatusOf(error));
            setServerField(null);
            if (view.kind === 'field') {
                setServerField({ field: view.field, key: view.key, params: view.params });
                return;
            }
            if (view.kind === 'releaseChanged' && view.release) {
                setRelease(view.release);
                setForm((f) => ({ ...f, notify: notifyDefault }));
            }
            if (view.kind === 'releaseChanged' || view.kind === 'stale') {
                invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
            }
            setConflict(view);
        },
    });

    const reloadCurrent = () => {
        if (conflict?.kind !== 'stale') return;
        const current = conflict.current;
        if (current) {
            setBase(current);
            setForm((f) => ({
                ...f,
                marks: current.state === 'NEEDS_MARKING' ? '' : formatMark(current.marks),
            }));
        }
        void queryClient.invalidateQueries({
            queryKey: submissionKeys.card(outline.attempt_id, row.section_id, row.question_id),
        });
        setConflict(null);
    };

    const canSave = errors.length === 0 && !save.isPending && conflict?.kind !== 'locked' && conflict?.kind !== 'forbidden';
    const marksErr = fieldError('marks');
    const reasonErr = fieldError('reason');
    const partsErr = fieldError('parts');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-dialog-tall w-dialog-md flex-col gap-0 overflow-y-auto p-0">
                <DialogTitle asChild>
                    <h2 className="rounded-t-lg bg-primary-50 p-4 text-subtitle font-semibold text-primary-500">
                        {notAnswered
                            ? t('edit.notAnsweredTitle', { number: row.question_number, name: learner })
                            : t('edit.title', { number: row.question_number, name: learner })}
                    </h2>
                </DialogTitle>
                <form
                    className="flex flex-col gap-4 p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (canSave) save.mutate();
                    }}
                >
                    <p className="text-caption text-neutral-500">{typeLabel(row.question_type)}</p>

                    {conflict && <ConflictBanner view={conflict} learner={learner} onReload={reloadCurrent} />}

                    {notAnswered ? (
                        <p className="text-body text-neutral-700">
                            {t('edit.notAnsweredBody', { max: formatMark(base.max_marks) })}
                        </p>
                    ) : (
                        <>
                            <div className="flex flex-col gap-1">
                                <label className="flex flex-wrap items-center gap-2 text-body font-medium text-neutral-700">
                                    {t('edit.marks')}
                                    <Input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.5"
                                        min={base.min_marks}
                                        max={base.max_marks ?? undefined}
                                        value={form.marks}
                                        onChange={(e) => setForm({ ...form, marks: e.target.value })}
                                        className={cn('h-9 w-24', marksErr && 'border-danger-400')}
                                        aria-invalid={!!marksErr}
                                        autoFocus
                                    />
                                    <span className="text-neutral-500">/ {formatMark(base.max_marks)}</span>
                                </label>
                                <span className="text-caption text-neutral-500">
                                    {base.state === 'NEEDS_MARKING' ? (
                                        t('edit.notMarkedYet')
                                    ) : (
                                        <>
                                            {t('edit.was', { marks: formatMark(base.marks) })}{' '}
                                            <MarkedByLabel row={base} className="text-caption text-neutral-500" />
                                        </>
                                    )}
                                </span>
                                {marksErr && <FieldMessage error={marksErr} />}
                            </div>

                            {form.parts.length > 0 && (
                                <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
                                    <label className="flex cursor-pointer items-center gap-2 text-body font-medium text-neutral-700">
                                        <Checkbox
                                            checked={form.useParts}
                                            onCheckedChange={(v) => setForm({ ...form, useParts: v === true })}
                                            aria-label={t('edit.byScheme')}
                                        />
                                        {t('edit.byScheme')}
                                    </label>
                                    {form.useParts && (
                                        <div className="flex flex-col gap-2">
                                            {form.parts.map((p, i) => (
                                                <label
                                                    key={`${p.criterion}-${i}`}
                                                    className="flex flex-wrap items-center justify-between gap-2 text-body text-neutral-700"
                                                >
                                                    <span className="min-w-0 flex-1">{p.criterion}</span>
                                                    <span className="flex items-center gap-1.5">
                                                        <Input
                                                            type="number"
                                                            inputMode="decimal"
                                                            step="0.5"
                                                            min={0}
                                                            max={p.max ?? undefined}
                                                            value={p.value}
                                                            onChange={(e) => {
                                                                const parts = form.parts.map((x, j) =>
                                                                    j === i ? { ...x, value: e.target.value } : x
                                                                );
                                                                setForm({
                                                                    ...form,
                                                                    parts,
                                                                    marks: formatMark(partSum(parts)),
                                                                });
                                                            }}
                                                            className="h-8 w-20"
                                                            aria-label={p.criterion}
                                                        />
                                                        <span className="text-neutral-500">/ {formatMark(p.max)}</span>
                                                    </span>
                                                </label>
                                            ))}
                                            <p className="text-caption text-neutral-600">
                                                {t('edit.schemeSum', { sum: formatMark(partSum(form.parts)) })}
                                            </p>
                                            {partsErr && <FieldMessage error={partsErr} />}
                                        </div>
                                    )}
                                </div>
                            )}

                            <label className="flex flex-col gap-1 text-body font-medium text-neutral-700">
                                {t('edit.feedback')}
                                <Textarea
                                    value={form.feedback}
                                    onChange={(e) => setForm({ ...form, feedback: e.target.value })}
                                    rows={3}
                                    placeholder={t('edit.feedbackPlaceholder')}
                                />
                            </label>
                        </>
                    )}

                    <label className="flex flex-col gap-1 text-body font-medium text-neutral-700">
                        <span>
                            {t('edit.reason')}{' '}
                            <span className="text-caption font-normal text-neutral-500">
                                {released ? t('edit.reasonRequired') : t('edit.reasonOptional')}
                            </span>
                        </span>
                        <Input
                            value={form.reason}
                            onChange={(e) => setForm({ ...form, reason: e.target.value })}
                            className={cn('h-9', reasonErr && conflict?.kind === 'releaseChanged' && 'border-danger-400')}
                            placeholder={t('edit.reasonPlaceholder')}
                        />
                        {reasonErr && (serverField?.field === 'reason' || conflict?.kind === 'releaseChanged') && (
                            <FieldMessage error={reasonErr} />
                        )}
                    </label>

                    {!notAnswered && isObjectiveType(row.question_type) && (
                        <p className="flex items-start gap-2 text-caption text-neutral-600">
                            <Info size={14} className="mt-0.5 shrink-0" />
                            {t('edit.objectiveHint')}
                        </p>
                    )}

                    {!notAnswered && hasPenNotes && (
                        <div className="rounded-md border border-neutral-200">
                            <button
                                type="button"
                                aria-expanded={notesOpen}
                                onClick={() => setNotesOpen((o) => !o)}
                                className="flex w-full items-center gap-1.5 px-3 py-2 text-start text-body font-medium text-neutral-700"
                            >
                                {notesOpen ? <CaretDown size={14} /> : <CaretRight size={14} className="rtl:rotate-180" />}
                                {t('edit.penNotes')}
                            </button>
                            {notesOpen && (
                                <div className="border-t border-neutral-200 p-3">
                                    <PenNotesEditor
                                        annotations={annotations}
                                        value={noteChoices}
                                        onChange={setNoteChoices}
                                        disabled={save.isPending}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {preview && (
                        <div className="flex flex-col gap-1 rounded-md bg-neutral-50 p-3 text-body text-neutral-700">
                            <p className="font-medium" data-testid="edit-total-preview">
                                {t('edit.totalPreview', {
                                    before: formatMark(preview.total_before),
                                    after: formatMark(preview.total_after),
                                })}
                            </p>
                            {preview.total_recomputed && (
                                <p className="flex items-start gap-1.5 text-caption text-info-700">
                                    <Info size={14} className="mt-0.5 shrink-0" />
                                    {t('edit.totalRecomputed', {
                                        stored: formatMark(preview.total_recomputed.stored_total),
                                        r6: formatMark(preview.total_recomputed.r6_before),
                                    })}
                                </p>
                            )}
                        </div>
                    )}

                    {released && (
                        <div className="flex flex-col gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                            <p className="text-body font-medium text-warning-700">
                                {t('edit.releasedNote', { name: learner })}
                            </p>
                            <label className="flex cursor-pointer items-center gap-2 text-body text-neutral-700">
                                <Checkbox
                                    checked={form.notify}
                                    onCheckedChange={(v) => setForm({ ...form, notify: v === true })}
                                    aria-label={t('edit.notify', { name: learner })}
                                />
                                {t('edit.notify', { name: learner })}
                            </label>
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                            {t('common.cancel')}
                        </MyButton>
                        <MyButton type="submit" buttonType="primary" scale="medium" disabled={!canSave}>
                            {save.isPending ? t('edit.saving') : notAnswered ? t('edit.saveNotAnswered') : t('edit.save')}
                        </MyButton>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const initialForm = (
    row: QuestionRow,
    detail: { evaluator_feedback: string | null; part_marks: { criterion: string; marks: number; max: number | null }[]; scheme_points: { name: string; max: number | null }[] } | null,
    notify: boolean
): EditForm => {
    const saved = detail?.part_marks ?? [];
    const parts =
        saved.length > 0
            ? saved.map((p) => ({ criterion: p.criterion, value: formatMark(p.marks), max: p.max }))
            : (detail?.scheme_points ?? []).map((p) => ({ criterion: p.name, value: '', max: p.max }));
    return {
        marks: row.state === 'NEEDS_MARKING' || row.state === 'NOT_ANSWERED' ? '' : formatMark(row.marks),
        feedback: detail?.evaluator_feedback ?? '',
        reason: '',
        notify,
        useParts: saved.length > 0,
        parts,
    };
};

const FieldMessage = ({ error }: { error: FieldError }) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    return <p className="text-caption text-danger-600">{t(error.key, error.params)}</p>;
};

const ConflictBanner = ({ view, learner, onReload }: { view: EditErrorView; learner: string; onReload: () => void }) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    let text: string;
    switch (view.kind) {
        case 'stale':
            text = view.current
                ? t('edit.conflict.stale', {
                      name: view.current.marked_by?.name || t('common.aTeacher'),
                      marks: formatMark(view.current.marks),
                  })
                : t('edit.conflict.staleUnknown');
            break;
        case 'releaseChanged':
            text = t('edit.conflict.released', { name: learner });
            break;
        case 'locked':
            text = t('edit.conflict.locked');
            break;
        case 'totalOnly':
            text = t('edit.conflict.totalOnly');
            break;
        case 'forbidden':
            text = t('edit.conflict.forbidden');
            break;
        default:
            text = view.kind === 'other' && view.message ? view.message : t('edit.conflict.failed');
    }
    return (
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-body text-danger-700">
            <span className="flex items-start gap-2">
                <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
                {text}
            </span>
            {view.kind === 'stale' && (
                <MyButton type="button" buttonType="secondary" scale="small" onClick={onReload}>
                    {t('edit.conflict.reload')}
                </MyButton>
            )}
        </div>
    );
};
