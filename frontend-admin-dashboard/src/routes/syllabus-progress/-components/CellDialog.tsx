import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import type {
    SyllabusBlock,
    SyllabusLearner,
    SyllabusMarkRequest,
    SyllabusProgressEntry,
    SyllabusStatus,
} from '@/services/syllabus-progress';
import { StatusPicker } from './StatusPicker';
import { blockLongLabel, formatDate } from './status-meta';

export const NOTE_MAX = 1000;
const STATUS_VALUES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'] as const;

export type MarkPayload = Omit<SyllabusMarkRequest, 'package_session_id'>;

/** One learner × one week block: status, which points are done, and a note. */
export function CellDialog({
    open,
    onOpenChange,
    learner,
    block,
    entry,
    onSave,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    learner: SyllabusLearner;
    block: SyllabusBlock;
    entry: SyllabusProgressEntry | undefined;
    onSave: (payload: MarkPayload) => Promise<unknown>;
}) {
    const { t, i18n } = useTranslation('syllabusProgress');

    const schema = useMemo(
        () =>
            z.object({
                status: z.enum(STATUS_VALUES, {
                    errorMap: () => ({ message: t('dialog.statusRequired') }),
                }),
                points_done: z.array(z.number()),
                note: z.string().max(NOTE_MAX, t('dialog.noteTooLong', { max: NOTE_MAX })),
            }),
        [t]
    );
    type Values = z.infer<typeof schema>;

    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: {
            status: entry?.status ?? 'NOT_STARTED',
            points_done: entry?.points_done ?? [],
            note: entry?.teacher_note ?? '',
        },
    });

    const points = block.points;
    const pointsDone = form.watch('points_done');
    const status = form.watch('status');
    const note = form.watch('note');

    const setStatus = (next: SyllabusStatus) => {
        form.setValue('status', next, { shouldDirty: true, shouldValidate: true });
        // Convenience only: a finished week ticks every point; "not started" clears them.
        if (next === 'COMPLETED' && form.getValues('points_done').length === 0) {
            form.setValue(
                'points_done',
                points.map((p) => p.seq),
                { shouldDirty: true }
            );
        }
        if (next === 'NOT_STARTED') form.setValue('points_done', [], { shouldDirty: true });
    };

    const togglePoint = (seq: number, on: boolean) => {
        const current = form.getValues('points_done');
        const next = on ? [...new Set([...current, seq])] : current.filter((s) => s !== seq);
        form.setValue(
            'points_done',
            next.sort((a, b) => a - b),
            { shouldDirty: true }
        );
        if (on && form.getValues('status') === 'NOT_STARTED') setStatus('IN_PROGRESS');
    };

    const submit = async (values: Values) => {
        const trimmed = values.note.trim();
        const payload: MarkPayload = {
            block_ids: [block.id],
            user_ids: [learner.user_id],
            status: values.status,
            points_done: values.points_done,
        };
        // Send the note when there is one, or when an existing note is being cleared.
        if (trimmed || entry?.teacher_note) payload.note = trimmed;
        await onSave(payload);
    };

    const updatedOn = formatDate(entry?.updated_at, i18n.language);
    const startedOn = formatDate(entry?.started_on, i18n.language);
    const completedOn = formatDate(entry?.completed_on, i18n.language);

    return (
        <MyDialog
            heading={learner.full_name}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={form.handleSubmit(submit)}
                        loadingText={t('dialog.saving')}
                    >
                        {t('dialog.save')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form
                    className="space-y-6"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void form.handleSubmit(submit)();
                    }}
                >
                    <div className="space-y-1">
                        <p className="text-subtitle font-semibold text-neutral-800">
                            {blockLongLabel(block, t)}
                        </p>
                        {learner.enrollment_number && (
                            <p className="text-caption text-neutral-500">
                                {t('grid.enrollment', { number: learner.enrollment_number })}
                            </p>
                        )}
                    </div>

                    <FormField
                        control={form.control}
                        name="status"
                        render={() => (
                            <FormItem>
                                <FormLabel>{t('dialog.status')}</FormLabel>
                                <FormControl>
                                    <div>
                                        <StatusPicker value={status} onChange={setStatus} />
                                    </div>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-body font-semibold text-neutral-800">
                                {t('dialog.pointsDone', {
                                    done: pointsDone.length,
                                    total: points.length,
                                })}
                            </span>
                            {points.length > 0 && (
                                <div className="flex items-center gap-2">
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        onClick={() =>
                                            points.forEach((p) => togglePoint(p.seq, true))
                                        }
                                    >
                                        {t('dialog.tickAll')}
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        onClick={() =>
                                            form.setValue('points_done', [], { shouldDirty: true })
                                        }
                                    >
                                        {t('dialog.clearPoints')}
                                    </MyButton>
                                </div>
                            )}
                        </div>
                        {points.length === 0 ? (
                            <p className="text-caption text-neutral-500">{t('dialog.noPoints')}</p>
                        ) : (
                            <ul className="divide-y divide-border rounded-md border border-border">
                                {points.map((point) => {
                                    const id = `point-${block.id}-${point.seq}`;
                                    return (
                                        <li key={point.seq} className="flex items-start gap-3 p-3">
                                            <Checkbox
                                                id={id}
                                                className="mt-1"
                                                checked={pointsDone.includes(point.seq)}
                                                onCheckedChange={(v) =>
                                                    togglePoint(point.seq, v === true)
                                                }
                                            />
                                            <Label
                                                htmlFor={id}
                                                className="cursor-pointer text-body font-regular leading-normal text-neutral-700"
                                            >
                                                <span className="me-1 text-neutral-500">
                                                    {point.seq}.
                                                </span>
                                                {point.text}
                                            </Label>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <FormField
                        control={form.control}
                        name="note"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('dialog.note')}</FormLabel>
                                <FormControl>
                                    <Textarea
                                        {...field}
                                        rows={3}
                                        placeholder={t('dialog.notePlaceholder')}
                                    />
                                </FormControl>
                                <div className="flex justify-between gap-2 text-caption text-neutral-500">
                                    <span>{t('dialog.noteHint')}</span>
                                    <span>
                                        {note.length}/{NOTE_MAX}
                                    </span>
                                </div>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {entry && (updatedOn || startedOn || completedOn) && (
                        <div className="flex items-start gap-2 text-caption text-neutral-500">
                            <ClockCounterClockwise className="mt-0.5 size-4 shrink-0" aria-hidden />
                            <div className="space-y-0.5">
                                {updatedOn && (
                                    <p>
                                        {entry.marked_by_name
                                            ? t('dialog.lastMarkedBy', {
                                                  name: entry.marked_by_name,
                                                  date: updatedOn,
                                              })
                                            : t('dialog.lastMarked', { date: updatedOn })}
                                    </p>
                                )}
                                {startedOn && <p>{t('dialog.startedOn', { date: startedOn })}</p>}
                                {completedOn && (
                                    <p>{t('dialog.completedOn', { date: completedOn })}</p>
                                )}
                            </div>
                        </div>
                    )}
                </form>
            </Form>
        </MyDialog>
    );
}
